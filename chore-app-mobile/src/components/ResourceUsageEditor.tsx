import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/providers/ThemeProvider';
import { createStyles } from '@/styles/theme';

type ResourceRow = { id: string; name: string; unit?: string | null };
type QtyMap = { [resourceId: string]: string };

/**
 * Lets a chore be linked to household resources it should draw down on
 * completion (e.g. "Arrumar a Loica" uses 1 dishwasher tablet). This
 * existed on the web frontend for scheduled/counter/timer chores, but the
 * actual input UI was never built on mobile -- the state and save call
 * (usesResources / attachResources) were wired up with nothing to type
 * quantities into.
 *
 * `value` maps resource_id -> quantity-per-completion as a string (kept as
 * a string so an empty/in-progress input doesn't get coerced to 0), and an
 * entry is only saved if it parses to a number > 0.
 */
export function ResourceUsageEditor({
  resources,
  value,
  onChange,
}: {
  resources: ResourceRow[];
  value: QtyMap;
  onChange: (next: QtyMap) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = createStyles(colors);

  if (!resources || resources.length === 0) {
    return (
      <Text style={[s.muted, { marginTop: 4 }]}>
        {t('No resources set up for this household yet.')}
      </Text>
    );
  }

  const setQty = (resourceId: string, qty: string) => {
    const next = { ...value };
    if (qty === '') {
      delete next[resourceId];
    } else {
      next[resourceId] = qty;
    }
    onChange(next);
  };

  return (
    <View style={{ gap: 8 }}>
      {resources.map((r) => (
        <View
          key={r.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <Text style={[s.switchLabel, { flex: 1 }]}>
            {r.name}
            {r.unit ? ` (${r.unit})` : ''}
          </Text>
          <TextInput
            style={[s.input, { width: 72, textAlign: 'center' }]}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.muted}
            value={value[r.id] ?? ''}
            onChangeText={(text) => setQty(r.id, text.replace(/[^0-9.]/g, ''))}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * Converts the { resourceId: qty } map used by the editor's controlled
 * state into the parallel-array shape update_chore_resources expects,
 * dropping any entry that's blank or not a positive number.
 */
export function resourceMapToArrays(map: QtyMap): { ids: string[]; qtys: number[] } {
  const ids: string[] = [];
  const qtys: number[] = [];
  for (const [id, raw] of Object.entries(map || {})) {
    const qty = Number(raw);
    if (raw !== '' && !Number.isNaN(qty) && qty > 0) {
      ids.push(id);
      qtys.push(qty);
    }
  }
  return { ids, qtys };
}
