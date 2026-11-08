// Habits works with zero groups, so it's always available. 'groups' only
// ever shows up as a tab when the person hasn't created/joined one yet —
// once they have, 'calendar' takes its place in the tab bar and Groups
// moves into Settings (household switcher) like before.
export type Tab = 'habits' | 'today' | 'create' | 'stock' | 'more' | 'groups';
export type Page = Tab | 'trades' | 'board' | 'you' | 'settings' | 'manage' | 'rewards' | 'calendar';

export type EventRow = {
  id: string;
  date: string;
  status: string;
  chore_type_id: string;
  assigned_user_id?: string;
  group_id?: string;
  consecutive_delays_count?: number;
  chore_event_assignees?: { user_id: string }[];
  chore_types?: {
    name?: string;
    icon?: string;
    has_schedule?: boolean;
    requires_photo?: boolean;
    has_counter?: boolean;
    has_timer?: boolean;
    is_delayable?: boolean;
    max_consecutive_delays?: number | null;
    is_rotational?: boolean;
  } | null;
};
