import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, Tag as TagIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabaseClient";
import { ErrorBanner, StatusChip } from "../components/UI";

// A handful of distinct-enough background colors, picked deterministically
// off the tag id so the same tag always renders the same color even
// though users don't pick one themselves today (create_tag accepts a
// color, this is just the default when none is set).
const TAG_PALETTE = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe", "#fed7aa", "#a5f3fc"];
function tagColor(tag) {
  if (tag.color) return tag.color;
  let hash = 0;
  for (const ch of tag.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

function TagChip({ tag, onRemove, small }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5"}`}
      style={{ background: tagColor(tag), color: "#1f2937" }}
    >
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="leading-none">
          <X size={small ? 9 : 11} />
        </button>
      )}
    </span>
  );
}

// Chip row above the lists — multi-select, OR semantics ("Food or
// Medicine"). Selecting nothing shows everything.
function TagFilterBar({ tags, selected, onToggle, t }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-1">
      {tags.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onToggle(tag.id)}
            className="text-xs px-2 py-1 rounded-full font-medium transition"
            style={{
              background: on ? tagColor(tag) : "var(--surface)",
              border: on ? "1.5px solid transparent" : "1.5px solid var(--border)",
              color: on ? "#1f2937" : "var(--ink)",
              opacity: on ? 1 : 0.75,
            }}
          >
            {tag.name}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button type="button" className="text-xs app-muted underline px-1" onClick={() => selected.forEach(onToggle)}>
          {t("Clear")}
        </button>
      )}
    </div>
  );
}

// Inline popover for assigning tags to one item: toggle existing tags,
// or type a new name and hit Enter/Add — create_tag dedupes by name
// (case-insensitive) server-side, so typing "Food" when "food" already
// exists just reuses it instead of making a duplicate.
function TagAssigner({ groupId, tags, selectedTagIds, onChange, onTagCreated, t }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo(() => {
    if (!newName.trim()) return [];
    const q = newName.trim().toLowerCase();
    return tags.filter((tg) => tg.name.toLowerCase().includes(q) && !selectedTagIds.includes(tg.id)).slice(0, 5);
  }, [newName, tags, selectedTagIds]);

  async function addByName(name) {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data: tagId, error } = await supabase.rpc("create_tag", { p_group_id: groupId, p_name: name.trim() });
      if (error) throw error;
      onTagCreated();
      if (!selectedTagIds.includes(tagId)) onChange([...selectedTagIds, tagId]);
      setNewName("");
    } finally {
      setBusy(false);
    }
  }

  function toggleExisting(tagId) {
    onChange(selectedTagIds.includes(tagId) ? selectedTagIds.filter((id) => id !== tagId) : [...selectedTagIds, tagId]);
  }

  if (!open) {
    return (
      <button className="app-btn p-1.5 app-muted" onClick={() => setOpen(true)} title={t("Tags")}>
        <TagIcon size={14} />
      </button>
    );
  }

  return (
    <div className="app-card app-radius p-2.5 flex flex-col gap-2 w-56 z-10 shadow-lg" style={{ position: "absolute" }}>
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold app-muted">{t("Tags")}</span>
        <button onClick={() => setOpen(false)}><X size={14} /></button>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tg) => {
            const on = selectedTagIds.includes(tg.id);
            return (
              <button
                key={tg.id}
                type="button"
                onClick={() => toggleExisting(tg.id)}
                className="text-[11px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1"
                style={{ background: tagColor(tg), opacity: on ? 1 : 0.4, color: "#1f2937" }}
              >
                {on && <Check size={9} />}
                {tg.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-1">
        <input
          className="app-input text-xs flex-1"
          placeholder={t("New tag…")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addByName(suggestions[0]?.name || newName);
            }
          }}
        />
        <button className="app-btn app-accent-bg px-2 text-xs" disabled={busy || !newName.trim()} onClick={() => addByName(newName)}>
          {t("Add")}
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {suggestions.map((s) => (
            <button
              key={s.id}
              className="text-xs text-left app-muted hover:underline"
              onClick={() => {
                toggleExisting(s.id);
                setNewName("");
              }}
            >
              {t("Use existing: {{name}}", { name: s.name })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Stock({ groupId }) {
  const { t } = useTranslation();
  const [resources, setResources] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [tags, setTags] = useState([]);
  const [filterTagIds, setFilterTagIds] = useState([]);
  const [newResourceName, setNewResourceName] = useState("");
  const [newResourceUnit, setNewResourceUnit] = useState("");
  const [newResourceQty, setNewResourceQty] = useState(1);
  const [flagName, setFlagName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!groupId) return;
    const [{ data: res }, { data: stock }, { data: tg }] = await Promise.all([
      supabase.from("resources").select("*, resource_tags(tag_id)").eq("group_id", groupId).order("name"),
      supabase.from("stock_items").select("*, stock_item_tags(tag_id)").eq("group_id", groupId).order("flagged_at", { ascending: false }),
      supabase.from("tags").select("*").eq("group_id", groupId).order("name"),
    ]);
    setResources(res || []);
    setStockItems(stock || []);
    setTags(tg || []);
  }, [groupId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`stock-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "resources", filter: `group_id=eq.${groupId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_items", filter: `group_id=eq.${groupId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tags", filter: `group_id=eq.${groupId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "resource_tags" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_item_tags" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load, groupId]);

  function toggleFilterTag(tagId) {
    setFilterTagIds((ids) => (ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]));
  }

  function matchesFilter(itemTagIds) {
    if (filterTagIds.length === 0) return true;
    return itemTagIds.some((id) => filterTagIds.includes(id));
  }

  async function addResource(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error } = await supabase
        .from("resources")
        .insert({ group_id: groupId, name: newResourceName, unit: newResourceUnit || null, qty: Number(newResourceQty) });
      if (error) throw error;
      setNewResourceName("");
      setNewResourceUnit("");
      setNewResourceQty(1);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setQty(resourceId, qty) {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("set_resource_qty", { p_resource_id: resourceId, p_qty: Number(qty) });
      if (error) throw error;
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function flagOut(e) {
    e.preventDefault();
    if (!flagName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("flag_out_of_stock", { p_group_id: groupId, p_name: flagName.trim() });
      if (error) throw error;
      setFlagName("");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(itemId) {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("resolve_stock_item", { p_item_id: itemId });
      if (error) throw error;
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setResourceTags(resourceId, tagIds) {
    setResources((rs) => rs.map((r) => (r.id === resourceId ? { ...r, resource_tags: tagIds.map((id) => ({ tag_id: id })) } : r)));
    const { error } = await supabase.rpc("set_resource_tags", { p_resource_id: resourceId, p_tag_ids: tagIds });
    if (error) {
      setError(error.message);
      await load();
    }
  }

  async function setStockItemTags(itemId, tagIds) {
    setStockItems((items) => items.map((s) => (s.id === itemId ? { ...s, stock_item_tags: tagIds.map((id) => ({ tag_id: id })) } : s)));
    const { error } = await supabase.rpc("set_stock_item_tags", { p_stock_item_id: itemId, p_tag_ids: tagIds });
    if (error) {
      setError(error.message);
      await load();
    }
  }

  const tagsById = useMemo(() => Object.fromEntries(tags.map((tg) => [tg.id, tg])), [tags]);

  const outItems = stockItems.filter((s) => s.status === "out" && matchesFilter((s.stock_item_tags || []).map((x) => x.tag_id)));
  const resolvedItems = stockItems.filter((s) => s.status === "resolved").slice(0, 10);
  const filteredResources = resources.filter((r) => matchesFilter((r.resource_tags || []).map((x) => x.tag_id)));

  return (
    <div className="flex flex-col gap-6 pb-10">
      <ErrorBanner error={error} onClose={() => setError("")} />

      <TagFilterBar tags={tags} selected={filterTagIds} onToggle={toggleFilterTag} t={t} />

      <div>
        <h3 className="text-sm font-semibold app-muted mb-2">{t("Out of stock")}</h3>
        <form onSubmit={flagOut} className="flex gap-2 mb-3">
          <input className="app-input" placeholder={t("We're out of…")} value={flagName} onChange={(e) => setFlagName(e.target.value)} />
          <button className="app-btn app-accent-bg px-3" disabled={busy} type="submit">
            <Plus size={16} />
          </button>
        </form>
        {outItems.length === 0 ? (
          <div className="text-sm app-muted app-card app-radius p-3">
            {filterTagIds.length > 0 ? t("Nothing out with these tags.") : t("Nothing's out right now.")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {outItems.map((s) => (
              <div key={s.id} className="app-card app-radius p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs app-muted">{t("Flagged {{date}}", { date: new Date(s.flagged_at).toLocaleDateString() })}</div>
                  {(s.stock_item_tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(s.stock_item_tags || []).map((x) => tagsById[x.tag_id] && (
                        <TagChip
                          key={x.tag_id}
                          tag={tagsById[x.tag_id]}
                          small
                          onRemove={() =>
                            setStockItemTags(s.id, (s.stock_item_tags || []).map((y) => y.tag_id).filter((id) => id !== x.tag_id))
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 relative">
                  <TagAssigner
                    groupId={groupId}
                    tags={tags}
                    selectedTagIds={(s.stock_item_tags || []).map((x) => x.tag_id)}
                    onChange={(ids) => setStockItemTags(s.id, ids)}
                    onTagCreated={load}
                    t={t}
                  />
                  <button className="app-btn app-card px-3 py-1.5 text-sm" disabled={busy} onClick={() => resolve(s.id)}>
                    <Check size={14} className="inline mr-1" /> {t("Restocked")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold app-muted mb-2">{t("Tracked resources")}</h3>
        <p className="text-xs app-muted mb-2">
          {t("Resources here can be attached to a chore in Create so completing it automatically uses some up — hitting zero flags it out automatically.")}
        </p>
        <form onSubmit={addResource} className="app-card app-radius p-3 flex flex-wrap gap-2 mb-3 items-end">
          <div className="flex-1 min-w-[100px]">
            <label className="text-xs app-muted">{t("Name")}</label>
            <input className="app-input mt-1" value={newResourceName} onChange={(e) => setNewResourceName(e.target.value)} required />
          </div>
          <div className="w-20">
            <label className="text-xs app-muted">{t("Unit")}</label>
            <input className="app-input mt-1" placeholder="pods" value={newResourceUnit} onChange={(e) => setNewResourceUnit(e.target.value)} />
          </div>
          <div className="w-20">
            <label className="text-xs app-muted">{t("Qty")}</label>
            <input className="app-input mt-1" type="number" min={0} step="0.5" value={newResourceQty} onChange={(e) => setNewResourceQty(e.target.value)} />
          </div>
          <button className="app-btn app-accent-bg px-3 py-2" disabled={busy} type="submit">
            {t("Add")}
          </button>
        </form>
        {filteredResources.length === 0 && filterTagIds.length > 0 ? (
          <div className="text-sm app-muted app-card app-radius p-3">{t("No tracked resources with these tags.")}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredResources.map((r) => (
              <ResourceRow
                key={r.id}
                resource={r}
                tags={tags}
                tagsById={tagsById}
                groupId={groupId}
                onSetQty={(qty) => setQty(r.id, qty)}
                onSetTags={(ids) => setResourceTags(r.id, ids)}
                onTagCreated={load}
                busy={busy}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {resolvedItems.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold app-muted mb-2">{t("Recently restocked")}</h3>
          <div className="flex flex-col gap-1.5">
            {resolvedItems.map((s) => (
              <div key={s.id} className="text-xs app-muted flex justify-between">
                <span>{s.name}</span>
                <StatusChip status="resolved" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceRow({ resource, tags, tagsById, groupId, onSetQty, onSetTags, onTagCreated, busy, t }) {
  const [val, setVal] = useState(resource.qty);
  const tagIds = (resource.resource_tags || []).map((x) => x.tag_id);

  // Resync the displayed value whenever the backend quantity changes
  // (realtime updates, or a chore completion consuming stock) — otherwise
  // this stayed frozen at whatever it was on first render.
  useEffect(() => {
    setVal(resource.qty);
  }, [resource.qty]);

  return (
    <div className="app-card app-radius p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm">
          {resource.name} {resource.unit ? <span className="app-muted">({resource.unit})</span> : null}
        </div>
        {tagIds.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {tagIds.map((id) => tagsById[id] && (
              <TagChip key={id} tag={tagsById[id]} small onRemove={() => onSetTags(tagIds.filter((x) => x !== id))} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 relative">
        <TagAssigner groupId={groupId} tags={tags} selectedTagIds={tagIds} onChange={onSetTags} onTagCreated={onTagCreated} t={t} />
        <input
          className="app-input w-20"
          type="number"
          min={0}
          step="0.5"
          value={val}
          onChange={(e) => setVal(e.target.value)}
        />
        <button className="app-btn app-card px-2 py-1.5 text-xs" disabled={busy} onClick={() => onSetQty(val)}>
          {t("Set")}
        </button>
      </div>
    </div>
  );
}
