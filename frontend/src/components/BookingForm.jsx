import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { dateTime, fromLocalInput, toLocalInput } from "../lib/util";
import { Alert, Button, Check, Modal, Select, TextArea, TextInput } from "./ui";

function defaultTimes(role, project) {
  const d = role?.shoot_start || project?.shoot_start;
  const e = role?.shoot_end || project?.shoot_end || d;
  if (!d) return ["", ""];
  return [`${d}T08:00`, `${e}T20:00`];
}

// Create or edit a booking; surfaces conflicts (FR-015) and child/consent blockers.
export default function BookingForm({ booking, entry, role, project, onClose, onSaved }) {
  const { meta, toast } = useApp();
  const [s0, e0] = defaultTimes(role, project);
  const [f, setF] = useState(
    booking
      ? { ...booking, shoot_start: toLocalInput(booking.shoot_start), shoot_end: toLocalInput(booking.shoot_end), completed_on: booking.completed_on || "" }
      : {
          role: role.id,
          talent: entry.talent,
          shortlist_entry: entry.id,
          shoot_start: s0,
          shoot_end: e0,
          status: "tentative",
          proposed_fee: entry.proposed_fee ?? "",
          agreed_fee: "",
          fee_basis: entry.fee_basis || role.fee_basis || "",
          currency: "INR",
          travel_charges: "",
          accommodation_charges: "",
          other_charges_notes: "",
          confirmation_source: "",
          confirmation_notes: "",
          schedule_notes: "",
          outcome: "pending",
          completed_on: "",
          deliverable_url: "",
        }
  );
  const [conflict, setConflict] = useState(null);
  const [ack, setAck] = useState(false);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const upd = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const money = (v) => (v === "" || v === undefined ? null : v);

  const save = async () => {
    setBusy(true);
    setMsg("");
    setErrors({});
    const body = {
      ...f,
      shoot_start: fromLocalInput(f.shoot_start),
      shoot_end: fromLocalInput(f.shoot_end),
      proposed_fee: money(f.proposed_fee),
      agreed_fee: money(f.agreed_fee),
      travel_charges: money(f.travel_charges),
      accommodation_charges: money(f.accommodation_charges),
      completed_on: f.completed_on || null,
      acknowledge_warnings: ack,
      override,
      override_reason: reason,
    };
    try {
      const r = booking ? await api.patch(`bookings/${booking.id}/`, body) : await api.post("bookings/", body);
      toast(booking ? "Booking updated" : r.status === "confirmed" ? "Booking confirmed" : "Tentative hold created");
      onSaved(r);
    } catch (e) {
      if (["booking_conflict", "booking_warning"].includes(e.code)) setConflict(e.body);
      else if (e.code === "booking_blocked") setMsg(e.message);
      else {
        setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v.join(" ")])));
        setMsg(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const hasBlocking = conflict && conflict.conflicts && conflict.conflicts.length > 0 && ["confirmed", "completed"].includes(f.status);
  const canSave = !conflict || (hasBlocking ? override && reason.trim() : ack);

  return (
    <Modal
      wide
      title={booking ? `Booking: ${booking.talent_name} as ${booking.role_name}` : `Book ${entry.talent_detail.full_name} as ${role.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={override ? "danger" : "primary"} busy={busy} disabled={!canSave || !f.shoot_start || !f.shoot_end} onClick={save}>
            {override ? "Override and save" : booking ? "Save booking" : f.status === "confirmed" ? "Confirm booking" : "Create hold"}
          </Button>
        </>
      }
    >
      {msg && <Alert kind="error">{msg}</Alert>}
      {conflict && (
        <Alert kind={hasBlocking ? "error" : "warn"}>
          <strong>{conflict.detail}</strong>
          <ul className="tight">
            {[...(conflict.conflicts || []), ...(conflict.warnings || [])].map((c) => (
              <li key={`${c.type}-${c.id}`}>
                {c.label}: {dateTime(c.start)} – {dateTime(c.end)} ({c.status.replace(/_/g, " ")})
              </li>
            ))}
          </ul>
          {hasBlocking ? (
            <>
              <Check label="Override: book anyway despite the overlapping confirmed booking" checked={override} onChange={setOverride} />
              {override && <TextArea label="Reason for override (recorded in the audit log)" value={reason} onChange={setReason} rows={2} />}
            </>
          ) : (
            <Check label="I've checked these overlaps; save anyway" checked={ack} onChange={setAck} />
          )}
        </Alert>
      )}
      {meta && (
        <div className="grid-2">
          <TextInput label="Shoot starts" type="datetime-local" value={f.shoot_start} onChange={(v) => (upd("shoot_start")(v), setConflict(null))} required />
          <TextInput label="Shoot ends" type="datetime-local" value={f.shoot_end} onChange={(v) => (upd("shoot_end")(v), setConflict(null))} required error={errors.shoot_end} />
          <Select label="Status" value={f.status} onChange={(v) => (upd("status")(v), setConflict(null))} options={meta.booking_status} placeholder={null} />
          <Select label="Fee basis" value={f.fee_basis} onChange={upd("fee_basis")} options={meta.fee_basis} />
          <TextInput label="Proposed fee (₹)" type="number" min="0" value={f.proposed_fee ?? ""} onChange={upd("proposed_fee")} hint="What was first offered or quoted" />
          <TextInput label="Final agreed fee (₹)" type="number" min="0" value={f.agreed_fee ?? ""} onChange={upd("agreed_fee")} />
          <TextInput label="Travel charges (₹)" type="number" min="0" value={f.travel_charges ?? ""} onChange={upd("travel_charges")} />
          <TextInput label="Accommodation (₹)" type="number" min="0" value={f.accommodation_charges ?? ""} onChange={upd("accommodation_charges")} />
          <Select label="Confirmed via" value={f.confirmation_source} onChange={upd("confirmation_source")} options={meta.availability_source.filter((o) => o.value !== "system")} placeholder="Not confirmed yet" />
          <TextInput label="Other charges / notes" value={f.other_charges_notes} onChange={upd("other_charges_notes")} />
          {booking && <Select label="Outcome" value={f.outcome} onChange={upd("outcome")} options={meta.booking_outcome} placeholder={null} />}
          {booking && <TextInput label="Shoot completed on" type="date" value={f.completed_on} onChange={upd("completed_on")} />}
          {booking && <TextInput label="Deliverable / final video link" type="url" value={f.deliverable_url} onChange={upd("deliverable_url")} />}
        </div>
      )}
      <TextArea label="Confirmation details" value={f.confirmation_notes} onChange={upd("confirmation_notes")} rows={2} placeholder="Who confirmed, what was agreed" />
      <TextArea label="Schedule notes" value={f.schedule_notes} onChange={upd("schedule_notes")} rows={2} placeholder="Call time, location, wardrobe" />
    </Modal>
  );
}
