import { useState } from "react";
import { Link } from "../lib/router";
import { Button, Check, Modal } from "./ui";

const STRENGTH = { exact: "Same phone number", strong: "Strong match", possible: "Possible match" };

export default function DuplicateDialog({ duplicates, onCancel, onContinue, busy }) {
  const [ack, setAck] = useState(false);
  const exact = duplicates.some((d) => d.strength === "exact");
  return (
    <Modal
      title={exact ? "This phone number is already in the database" : "This person may already be in the database"}
      onClose={onCancel}
      wide
      footer={
        <>
          <Button onClick={onCancel}>Cancel and go back</Button>
          <Button variant={exact ? "danger" : "primary"} disabled={!ack} busy={busy} onClick={() => onContinue(duplicates.map((d) => d.id))}>
            Save as a separate person
          </Button>
        </>
      }
    >
      <p className="prose">Open the existing profile if it's the same person, so their history stays in one place.</p>
      <ul className="dup-list">
        {duplicates.map((d) => (
          <li key={d.id} className={`dup dup-${d.strength}`}>
            {d.photo ? <img src={d.photo} alt="" /> : <span className="dup-ph" />}
            <div>
              <strong>{d.full_name}</strong> <span className="muted">{d.cast_id}</span>
              <div className="small">
                {d.city}, {d.phone}
              </div>
              <div className="small dup-reasons">
                <span className="pill pill-warn">{STRENGTH[d.strength]}</span> {d.reasons.join(", ")}
              </div>
            </div>
            {!d.is_deleted && (
              <Link className="btn btn-sm" to={`/talent/${d.id}`} target="_blank" rel="noreferrer">
                Open existing
              </Link>
            )}
          </li>
        ))}
      </ul>
      <Check
        label={exact ? "I've checked: this is a different person who shares the phone number (e.g. a parent's number)." : "I've checked these records and this is a different person."}
        checked={ack}
        onChange={setAck}
      />
    </Modal>
  );
}
