import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { useChoreApp } from '@/providers/ChoreAppProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';
import { Button, Empty, Field, Notice, Section } from '@/components/ui/primitives';

// Tags are shared across Stock (resources + out-of-stock flags), scoped to
// the group, freely assignable, and created-or-reused by name — mirrors
// the web implementation's RPC contract exactly.

const TAG_PALETTE = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#a5f3fc'];
function tagColor(tag: any) {
  if (tag.color) return tag.color;
  let hash = 0;
  for (const ch of tag.id as string) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

export function StockScreen() {
  const { t } = useTranslation();
  const { groupId } = useChoreApp();
  const { colors } = useTheme();
  const s = createStyles(colors);

  const [resources, setResources] = useState<any[]>([]);
  const [out, setOut] = useState<any[]>([]);
  const [resolved, setResolved] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagTarget, setTagTarget] = useState<{ kind: 'resource' | 'stock_item'; id: string; tagIds: string[] } | null>(null);

  const load = useCallback(async () => {
    if (!groupId) return;
    // Fetch every stock item (not just out-of-stock) and split it client-side,
    // same as web, so "recently restocked" history can be shown too.
    const [
      { data: nextResources, error: resourcesError },
      { data: stock, error: stockError },
      { data: tg, error: tagError },
    ] = await Promise.all([
      supabase.from('resources').select('*, resource_tags(tag_id)').eq('group_id', groupId).order('name'),
      supabase.from('stock_items').select('*, stock_item_tags(tag_id)').eq('group_id', groupId).order('flagged_at', { ascending: false }),
      supabase.from('tags').select('*').eq('group_id', groupId).order('name'),
    ]);
    if (resourcesError || stockError || tagError) {
      setMessage(resourcesError?.message ?? stockError?.message ?? tagError?.message ?? t('Could not load stock.'));
    } else {
      setResources(nextResources ?? []);
      setOut((stock ?? []).filter((item) => item.status === 'out'));
      setResolved((stock ?? []).filter((item) => item.status === 'resolved').slice(0, 10));
      setTags(tg ?? []);
    }
  }, [groupId]);

  useEffect(() => {
    load();
    if (!groupId) return;
    const ch = supabase
      .channel('stock-tags-mobile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tags', filter: `group_id=eq.${groupId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_tags' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_item_tags' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load, groupId]);

  function toggleFilterTag(tagId: string) {
    setFilterTagIds((ids) => (ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]));
  }

  function matchesFilter(itemTagIds: string[]) {
    if (filterTagIds.length === 0) return true;
    return itemTagIds.some((id) => filterTagIds.includes(id));
  }

  const tagsById = useMemo(() => Object.fromEntries(tags.map((tg) => [tg.id, tg])), [tags]);

  const add = async () => {
    if (!groupId || !name.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from('resources')
      .insert({ group_id: groupId, name: name.trim(), unit: unit.trim() || null, qty: Number(quantity) || 0 });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setName('');
      setUnit('');
      setQuantity('1');
      load();
    }
  };

  const flag = async () => {
    if (!groupId || !name.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('flag_out_of_stock', { p_group_id: groupId, p_name: name.trim() });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setName('');
      load();
    }
  };

  const setQty = async (resource: any, amount: number) => {
    const { error } = await supabase.rpc('set_resource_qty', { p_resource_id: resource.id, p_qty: Math.max(0, amount) });
    if (error) setMessage(error.message);
    else load();
  };

  const restock = async (item: any) => {
    const { error } = await supabase.rpc('resolve_stock_item', { p_item_id: item.id });
    if (error) setMessage(error.message);
    else load();
  };

  async function applyTags(kind: 'resource' | 'stock_item', id: string, tagIds: string[]) {
    if (kind === 'resource') {
      setResources((rs) => rs.map((r) => (r.id === id ? { ...r, resource_tags: tagIds.map((tid) => ({ tag_id: tid })) } : r)));
      const { error } = await supabase.rpc('set_resource_tags', { p_resource_id: id, p_tag_ids: tagIds });
      if (error) setMessage(error.message);
    } else {
      setOut((items) => items.map((it) => (it.id === id ? { ...it, stock_item_tags: tagIds.map((tid) => ({ tag_id: tid })) } : it)));
      const { error } = await supabase.rpc('set_stock_item_tags', { p_stock_item_id: id, p_tag_ids: tagIds });
      if (error) setMessage(error.message);
    }
  }

  const outItems = out.filter((item) => matchesFilter((item.stock_item_tags || []).map((x: any) => x.tag_id)));
  const filteredResources = resources.filter((r) => matchesFilter((r.resource_tags || []).map((x: any) => x.tag_id)));

  return (
    <KeyboardAwareScrollView contentContainerStyle={s.scroll} enableOnAndroid={true} extraScrollHeight={20}>
      <Notice message={message} error />

      {tags.length > 0 && (
        <View style={s.tagFilterRow}>
          {tags.map((tag) => {
            const on = filterTagIds.includes(tag.id);
            return (
              <Pressable
                key={tag.id}
                style={[s.tagFilterChip, on && s.tagFilterChipActive, on && { backgroundColor: tagColor(tag) }]}
                onPress={() => toggleFilterTag(tag.id)}
              >
                <Text style={[s.tagFilterChipText, on && s.tagFilterChipTextActive]}>{tag.name}</Text>
              </Pressable>
            );
          })}
          {filterTagIds.length > 0 && (
            <Pressable onPress={() => setFilterTagIds([])}>
              <Text style={s.tagFilterClear}>{t('Clear')}</Text>
            </Pressable>
          )}
        </View>
      )}

      <Section title={t('Out of stock')} caption={outItems.length ? t('{{count}} items', { count: outItems.length }) : t('All good')}>
        {outItems.length ? (
          outItems.map((item) => {
            const itemTagIds = (item.stock_item_tags || []).map((x: any) => x.tag_id);
            return (
              <View style={s.stockItemRow} key={item.id}>
                <View style={s.stockItemTop}>
                  <View style={s.warningIcon}>
                    <Ionicons name="alert" color={colors.red} size={18} />
                  </View>
                  <Text style={[s.quickName, { flex: 1 }]}>{item.name}</Text>
                  <View style={s.stockItemActions}>
                    <Pressable style={s.iconButtonSmall} onPress={() => setTagTarget({ kind: 'stock_item', id: item.id, tagIds: itemTagIds })}>
                      <Ionicons name="pricetag-outline" size={16} color={colors.muted} />
                    </Pressable>
                    <Pressable style={s.outlineButton} onPress={() => restock(item)}>
                      <Text style={s.outlineText}>{t('Restocked')}</Text>
                    </Pressable>
                  </View>
                </View>
                {itemTagIds.length > 0 && (
                  <View style={s.tagChipsWrap}>
                    {itemTagIds.map((tid: string) =>
                      tagsById[tid] ? (
                        <Pressable
                          key={tid}
                          style={[s.tagChip, { backgroundColor: tagColor(tagsById[tid]) }]}
                          onPress={() => applyTags('stock_item', item.id, itemTagIds.filter((x: string) => x !== tid))}
                        >
                          <Text style={s.tagChipText}>{tagsById[tid].name}</Text>
                          <Ionicons name="close" size={11} color="#1f2937" />
                        </Pressable>
                      ) : null
                    )}
                  </View>
                )}
              </View>
            );
          })
        ) : (
          <Empty text={filterTagIds.length > 0 ? t('Nothing out with these tags.') : t('Nothing is marked out right now.')} />
        )}
      </Section>

      <Section title={t('Tracked resources')}>
        {filteredResources.length === 0 && filterTagIds.length > 0 ? (
          <Empty text={t('No tracked resources with these tags.')} />
        ) : filteredResources.length ? (
          filteredResources.map((resource) => {
            const tagIds = (resource.resource_tags || []).map((x: any) => x.tag_id);
            return (
              <View style={s.stockItemRow} key={resource.id}>
                <View style={s.stockItemTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.taskTitle}>{resource.name}</Text>
                    <Text style={s.taskDue}>{resource.unit || t('items')}</Text>
                  </View>
                  <Pressable style={s.iconButtonSmall} onPress={() => setTagTarget({ kind: 'resource', id: resource.id, tagIds })}>
                    <Ionicons name="pricetag-outline" size={16} color={colors.muted} />
                  </Pressable>
                  <View style={s.stepper}>
                    <Pressable onPress={() => setQty(resource, Number(resource.qty) - 1)}>
                      <Ionicons name="remove" size={18} color={colors.ink} />
                    </Pressable>
                    <Text style={s.qty}>{resource.qty}</Text>
                    <Pressable onPress={() => setQty(resource, Number(resource.qty) + 1)}>
                      <Ionicons name="add" size={18} color={colors.ink} />
                    </Pressable>
                  </View>
                </View>
                {tagIds.length > 0 && (
                  <View style={s.tagChipsWrap}>
                    {tagIds.map((tid: string) =>
                      tagsById[tid] ? (
                        <Pressable
                          key={tid}
                          style={[s.tagChip, { backgroundColor: tagColor(tagsById[tid]) }]}
                          onPress={() => applyTags('resource', resource.id, tagIds.filter((x: string) => x !== tid))}
                        >
                          <Text style={s.tagChipText}>{tagsById[tid].name}</Text>
                          <Ionicons name="close" size={11} color="#1f2937" />
                        </Pressable>
                      ) : null
                    )}
                  </View>
                )}
              </View>
            );
          })
        ) : (
          <Empty text={t('Add supplies you want chores to keep track of.')} />
        )}
      </Section>

      {resolved.length > 0 && (
        <Section title={t('Recently restocked')}>
          {resolved.map((item) => (
            <View style={s.stockHistoryRow} key={item.id}>
              <Text style={s.stockHistoryText}>{item.name}</Text>
              <View style={s.restockedChip}>
                <Text style={s.restockedText}>{t('Restocked')}</Text>
              </View>
            </View>
          ))}
        </Section>
      )}

      <View style={s.form}>
        <Field label={t('Add a resource or flag an item out')} value={name} onChangeText={setName} placeholder={t('Dishwasher tablets')} />
        <View style={s.buttonRow}>
          <View style={s.formHalf}>
            <Field label={t('Starting quantity')} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
          </View>
          <View style={s.formHalf}>
            <Field label={t('Unit')} value={unit} onChangeText={setUnit} placeholder={t('rolls')} />
          </View>
        </View>
        <View style={s.buttonRow}>
          <Button label={t('Add resource')} onPress={add} disabled={busy || !name.trim()} compact />
          <Button label={t('Flag out')} onPress={flag} disabled={busy || !name.trim()} compact secondary />
        </View>
      </View>

      {tagTarget && (
        <TagAssignerModal
          groupId={groupId}
          tags={tags}
          selectedTagIds={tagTarget.tagIds}
          t={t}
          colors={colors}
          s={s}
          onClose={() => setTagTarget(null)}
          onChange={(ids: string[]) => {
            setTagTarget((prev) => (prev ? { ...prev, tagIds: ids } : prev));
            applyTags(tagTarget.kind, tagTarget.id, ids);
          }}
          onTagCreated={load}
        />
      )}
    </KeyboardAwareScrollView>
  );
}

function TagAssignerModal({ groupId, tags, selectedTagIds, t, colors, s, onClose, onChange, onTagCreated }: any) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const suggestions = useMemo(() => {
    const q = newName.trim().toLowerCase();
    if (!q) return [];
    return tags.filter((tg: any) => tg.name.toLowerCase().includes(q) && !selectedTagIds.includes(tg.id)).slice(0, 5);
  }, [newName, tags, selectedTagIds]);

  function toggleExisting(tagId: string) {
    onChange(selectedTagIds.includes(tagId) ? selectedTagIds.filter((id: string) => id !== tagId) : [...selectedTagIds, tagId]);
  }

  async function createAndAdd(name: string) {
    if (!name.trim() || !groupId) return;
    setBusy(true);
    setError('');
    try {
      const { data: tagId, error } = await supabase.rpc('create_tag', { p_group_id: groupId, p_name: name.trim() });
      if (error) throw error;
      setNewName('');
      onTagCreated();
      if (!selectedTagIds.includes(tagId)) onChange([...selectedTagIds, tagId]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <KeyboardAwareScrollView contentContainerStyle={s.modalContent} enableOnAndroid={true} extraScrollHeight={20}>
            <View style={s.modalHeadRow}>
              <Text style={s.modalTitle}>{t('Tags')}</Text>
              <Pressable onPress={onClose}>
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
            </View>

            <Notice message={error} error />

            {tags.length > 0 && (
              <View style={s.tagPickerRow}>
                {tags.map((tg: any) => {
                  const on = selectedTagIds.includes(tg.id);
                  return (
                    <Pressable
                      key={tg.id}
                      style={[s.tagPickerChip, { backgroundColor: tagColor(tg), opacity: on ? 1 : 0.4 }]}
                      onPress={() => toggleExisting(tg.id)}
                    >
                      <Text style={s.tagPickerChipText}>{tg.name}</Text>
                      {on && <Ionicons name="checkmark" size={12} color="#1f2937" />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={s.tagNewRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('New tag…')}
                placeholderTextColor="#9AA097"
                onSubmitEditing={() => createAndAdd(newName)}
              />
              <Button label={t('Add')} onPress={() => createAndAdd(newName)} disabled={busy || !newName.trim()} compact />
            </View>

            {suggestions.map((sug: any) => (
              <Pressable key={sug.id} onPress={() => toggleExisting(sug.id)}>
                <Text style={s.tagSuggestion}>{t('Use existing: {{name}}', { name: sug.name })}</Text>
              </Pressable>
            ))}
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>
  );
}
