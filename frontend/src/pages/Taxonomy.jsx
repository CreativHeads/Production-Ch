import { useState } from "react";
import { PageHead } from "../components/Layout";
import { Alert, Button, Check, ErrorBox, IconButton, Modal, Select, Spinner, Tabs, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link } from "../lib/router";

const KINDS = [
  { value: "category", label: "Categories", filter: "category" },
  { value: "tag", label: "Tags", filter: "tag" },
  { value: "skill", label: "Skills", filter: "skill" },
  { value: "language", label: "Languages", filter: "language" },
];

export default function Taxonomy() {
  const { toast, loadTerms } = useApp();
  const [kind, setKind] = useState("category");
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.get("terms/", { kind, usage: 1, archived: showArchived ? "include" : "" }), [kind, showArchived]);
  const [name, setName] = useState("");
  const [rename, setRename] = useState(null);
  const [merge, setMerge] = useState(null);
  const label = KINDS.find((k) => k.value === kind).label.toLowerCase();

  const refresh = () => {
    reload();
    loadTerms();
  };
  const call = async (fn, msg) => {
    try {
      await fn();
      toast(msg);
      refresh();
      return true;
    } catch (e) {
      toast(e.message, "error");
      return false;
    }
  };

  return (
    <div className="narrow">
      <PageHead title="Categories, tags, skills & languages" subtitle="Renaming updates every profile at once. Merging moves everyone from one term to another." />
      <Tabs tabs={KINDS} value={kind} onChange={setKind} />
      <form className="add-term" onSubmit={async (e) => (e.preventDefault(), name.trim() && (await call(() => api.post("terms/", { kind, name: name.trim() }), "Added")) && setName(""))}>
        <TextInput label={`New ${label.replace(/s$/, "").replace(/ie$/, "y")}`} value={name} onChange={setName} />
        <Button type="submit" variant="primary" disabled={!name.trim()}>Add</Button>
      </form>
      <Check label="Show archived and merged" checked={showArchived} onChange={setShowArchived} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <ul className="term-list">
          {data.map((t) => (
            <li key={t.id} className={t.is_archived ? "is-archived" : ""}>
              <span className="term-name">
                {t.name}
                {t.system_key === "child" && <span className="pill pill-warn">Triggers guardian rules</span>}
                {t.merged_into_name && <span className="muted small">merged into {t.merged_into_name}</span>}
              </span>
              <Link to={`/talent?${KINDS.find((k) => k.value === kind).filter}=${t.id}`} className="small">{t.usage} profile{t.usage === 1 ? "" : "s"}</Link>
              <span className="term-tools">
                <IconButton icon="edit" label="Rename" onClick={() => setRename({ ...t })} />
                {!t.is_archived && <Button size="sm" variant="ghost" onClick={() => setMerge(t)}>Merge</Button>}
                {t.is_archived ? (
                  <Button size="sm" variant="ghost" onClick={() => call(() => api.patch(`terms/${t.id}/`, { is_archived: false }), "Restored")}>Restore</Button>
                ) : (
                  t.system_key !== "child" && <IconButton icon="archive" label="Archive" onClick={() => call(() => api.del(`terms/${t.id}/`), "Archived. Existing profiles keep it, but it's hidden from pickers.")} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rename && (
        <Modal title={`Rename “${rename.name}”`} onClose={() => setRename(null)} footer={<><Button onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" onClick={async () => (await call(() => api.patch(`terms/${rename.id}/`, { name: rename.name }), "Renamed")) && setRename(null)}>Rename</Button></>}>
          <TextInput label="New name" value={rename.name} onChange={(v) => setRename((r) => ({ ...r, name: v }))} />
          <p className="muted small">Every profile and role using it shows the new name. History is unchanged.</p>
        </Modal>
      )}
      {merge && <MergeDialog term={merge} terms={data.filter((x) => x.id !== merge.id && !x.is_archived)} onClose={() => setMerge(null)} onMerged={() => (setMerge(null), refresh())} />}
    </div>
  );
}

function MergeDialog({ term, terms, onClose, onMerged }) {
  const { toast } = useApp();
  const [into, setInto] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post(`terms/${term.id}/merge/`, { into: Number(into) });
      toast(`Merged: ${r.moved} profiles moved to ${r.into.name}`);
      onMerged();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Merge “${term.name}”`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!into} onClick={go}>Merge</Button></>}>
      <Select label="Merge into" value={into} onChange={setInto} options={terms.map((t) => ({ value: t.id, label: t.name }))} placeholder="Choose" />
      <Alert kind="info">Everyone with “{term.name}” gets the chosen term instead, and “{term.name}” is archived. This can't be undone automatically.</Alert>
    </Modal>
  );
}
