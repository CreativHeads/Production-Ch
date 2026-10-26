import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { Link } from "../lib/router";
import { ageRange, cx, feeLabel, labelOf, relative } from "../lib/util";
import { Icon, IconButton, Meter } from "./ui";

export function Portrait({ photo, name, size = "card" }) {
  const src = photo && (size === "thumb" ? photo.thumb : photo.card);
  if (!src) {
    const initials = (name || "?").split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
    return (
      <div className={cx("portrait portrait-empty", `portrait-${size}`)} aria-hidden="true">
        {initials}
      </div>
    );
  }
  return <img className={cx("portrait", `portrait-${size}`)} src={src} alt={photo.label || name} loading="lazy" />;
}

export function FavoriteButton({ talent, onChange }) {
  const { toast } = useApp();
  const toggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const r = talent.is_favorite ? await api.del(`talent/${talent.id}/favorite/`) : await api.post(`talent/${talent.id}/favorite/`);
      onChange && onChange(r.is_favorite);
    } catch (err) {
      toast(err.message, "error");
    }
  };
  return (
    <IconButton
      icon="star"
      className="fav-btn"
      active={talent.is_favorite}
      label={talent.is_favorite ? "Remove from my favourites" : "Add to my favourites"}
      onClick={toggle}
    />
  );
}

export default function TalentCard({ t, onFavorite, selectable, selected, onSelect, from }) {
  const { meta } = useApp();
  const href = `/talent/${t.id}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  return (
    <article className={cx("tcard", t.is_archived && "is-archived", selected && "is-selected")}>
      <Link to={href} className="tcard-link" aria-label={`${t.full_name}, ${t.cast_id}`}>
        <div className="tcard-photo">
          <Portrait photo={t.photo} name={t.full_name} />
          <span className="slate">{t.cast_id}</span>
          {t.status === "needs_details" && <span className="tcard-flag">Needs details</span>}
          {t.consent_hold && <span className="tcard-flag tcard-flag-hold">Consent hold</span>}
        </div>
        <div className="tcard-body">
          <h3>{t.full_name}</h3>
          <p className="tcard-meta">
            {[t.gender && labelOf(meta?.gender, t.gender), ageRange(t) && `plays ${ageRange(t)}`, t.city].filter(Boolean).join(", ")}
          </p>
          <p className="tcard-cats">{t.categories.map((c) => c.name).join(" / ")}</p>
          {feeLabel(t, meta) && <p className="tcard-fee">{feeLabel(t, meta)}</p>}
        </div>
      </Link>
      <div className="tcard-actions">
        {selectable && (
          <label className="tcard-select" title="Select">
            <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(t.id, e.target.checked)} aria-label={`Select ${t.full_name}`} />
          </label>
        )}
        <FavoriteButton talent={t} onChange={(v) => onFavorite && onFavorite(t.id, v)} />
        <a className="icon-btn" href={`tel:${t.phone}`} aria-label={`Call ${t.full_name}`} title="Call" onClick={(e) => e.stopPropagation()}>
          <Icon name="phone" />
        </a>
        {t.whatsapp && (
          <a className="icon-btn" href={`https://wa.me/${t.whatsapp}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${t.full_name}`} title="Open WhatsApp chat">
            <Icon name="chat" />
          </a>
        )}
      </div>
    </article>
  );
}

export function TalentRow({ t, onFavorite, selectable, selected, onSelect, from }) {
  const { meta } = useApp();
  const href = `/talent/${t.id}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  return (
    <tr className={cx(t.is_archived && "is-archived", selected && "is-selected")}>
      {selectable && (
        <td className="col-check">
          <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(t.id, e.target.checked)} aria-label={`Select ${t.full_name}`} />
        </td>
      )}
      <td className="col-photo">
        <Portrait photo={t.photo} name={t.full_name} size="thumb" />
      </td>
      <td>
        <Link to={href} className="row-name">{t.full_name}</Link>
        <div className="row-sub">{t.cast_id}</div>
      </td>
      <td>{t.categories.map((c) => c.name).join(", ")}</td>
      <td>{ageRange(t)}</td>
      <td>{[t.city, t.district].filter(Boolean).join(", ")}</td>
      <td>{t.languages.join(", ")}</td>
      <td className="num">{feeLabel(t, meta)}</td>
      <td><Meter value={t.completeness} /></td>
      <td className="row-sub">{relative(t.last_contact_at)}</td>
      <td className="col-actions">
        <FavoriteButton talent={t} onChange={(v) => onFavorite && onFavorite(t.id, v)} />
        <a className="icon-btn" href={`tel:${t.phone}`} aria-label={`Call ${t.full_name}`} title="Call">
          <Icon name="phone" />
        </a>
      </td>
    </tr>
  );
}
