import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Gift, Palette, Sparkles, Plus, AlertCircle, ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCosmetics } from '../contexts/CosmeticsProvider';
import { IconGlyph, IconPicker } from '../components/UI';

// Cosmetics catalog item names, per theme/effect, kept in-flavor for each
// language rather than run through the general t() dictionary — a
// straight dictionary lookup would flatten "Enchanted Forest" and
// "Floresta Encantada" to a single literal key.
const CATALOG_NAMES = {
  en: {
    neutral: '✨ Default', none: '🚫 None',
    cutesy: '🌸 Cutesy', minimalist: '◻️ Minimalist', cyberpunk: '🌃 Cyberpunk', fantasy: '⚔️ Fantasy RPG',
    corporate: '💼 Corporate', victorian: '🎩 Victorian', wonderland: '🐰 Wonderland', steampunk: '⚙️ Steampunk',
    enchanted: '🧚 Enchanted Forest', cosmic: '🌌 Cosmic Galaxy', retro: '📻 Retro',
    confetti: '🎊 Confetti', fireworks: '🎆 Fireworks', sparkles: '✨ Sparkles', wave: '🌊 Wave Ripple', shake: '📳 Screen Shake',
  },
  pt: {
    neutral: '✨ Padrão', none: '🚫 Nenhum',
    cutesy: '🌸 Fofo', minimalist: '◻️ Minimalista', cyberpunk: '🌃 Cyberpunk', fantasy: '⚔️ Fantasia RPG',
    corporate: '💼 Corporativo', victorian: '🎩 Vitoriano', wonderland: '🐰 País das Maravilhas', steampunk: '⚙️ Steampunk',
    enchanted: '🧚 Floresta Encantada', cosmic: '🌌 Galáxia Cósmica', retro: '📻 Retro',
    confetti: '🎊 Confetes', fireworks: '🎆 Fogo de Artifício', sparkles: '✨ Brilhos', wave: '🌊 Onda', shake: '📳 Tremor de Ecrã',
  },
};

export default function Rewards({ group, user, roster }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('pt') ? 'pt' : 'en';
  const names = CATALOG_NAMES[lang];
  const { cosmetics, setCosmetics } = useCosmetics();
  const rewardsEnabled = !!group?.rewards_enabled;
  const cosmeticsUnlockedForAll = !!group?.cosmetics_unlocked_for_all;
  
  const [activeTab, setActiveTab] = useState(rewardsEnabled ? 'group' : 'cosmetics');
  const [wallet, setWallet] = useState({ coin_balance: 0, unlocked_cosmetics: [] });
  const [rewards, setRewards] = useState([]);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newReward, setNewReward] = useState({ name: '', description: '', cost: 10, icon: '🎁', color_theme: 'teal', perk_type: 'custom' });
  
  const isAdmin = roster.find(r => r.user_id === user.id)?.role !== 'member';

  useEffect(() => {
    if (!group) return;
    fetchData();
  }, [group]);

  const fetchData = async () => {
    // Fetch wallet
    const { data: walletData } = await supabase.rpc('get_user_wallet', { p_group_id: group.id });
    if (walletData && walletData[0]) setWallet(walletData[0]);

    // Fetch rewards
    const { data: rewardsData } = await supabase.from('rewards').select('*').eq('group_id', group.id).eq('archived', false).order('cost', { ascending: true });
    if (rewardsData) setRewards(rewardsData);
  };

  const handleCreateReward = async (e) => {
    e.preventDefault();
    await supabase.rpc('create_reward', {
      p_group_id: group.id,
      p_name: newReward.name,
      p_description: newReward.description,
      p_cost: newReward.cost,
      p_icon: newReward.icon,
      p_color_theme: newReward.color_theme,
      p_perk_type: newReward.perk_type
    });
    setShowAddModal(false);
    fetchData();
  };

  const purchaseReward = async (reward) => {
    if (wallet.coin_balance < reward.cost) return alert(t('Not enough coins!'));
    if (!confirm(t('Redeem {{name}} for {{cost}} coins?', { name: reward.name, cost: reward.cost }))) return;
    
    const { error } = await supabase.rpc('purchase_reward', { p_reward_id: reward.id });
    if (error) alert(error.message);
    else {
      alert(t('Purchased successfully!'));
      fetchData();
    }
  };

  const isUnlocked = (type, value) => {
    if (cosmeticsUnlockedForAll) return true; // Admin unlocked everything for the household
    if (type === 'theme' && value === 'neutral') return true; // Default free
    if (type === 'effect' && value === 'none') return true; // Default free
    return wallet.unlocked_cosmetics?.some(c => c.type === type && c.data === value);
  };

  const purchaseCosmetic = async (item) => {
    if (cosmeticsUnlockedForAll) return; // Nothing to buy — already unlocked for everyone
    if (wallet.coin_balance < item.cost) return alert(t('Not enough coins!'));
    if (!confirm(t('Buy {{name}} for {{cost}} coins?', { name: item.name, cost: item.cost }))) return;
    
    // We need to create a temporary reward in the DB to use the RPC, or we can just run a custom SQL update.
    // For simplicity, we'll manually deduct and unlock since it's a fixed catalog.
    const newBalance = wallet.coin_balance - item.cost;
    const newUnlocks = [...(wallet.unlocked_cosmetics || []), { type: item.type, data: item.value, name: item.name }];
    
    await supabase.from('memberships').update({ 
      coin_balance: newBalance,
      unlocked_cosmetics: newUnlocks 
    }).eq('group_id', group.id).eq('user_id', user.id);
    
    fetchData();
  };

  const equipCosmetic = (type, value) => {
    setCosmetics({ [type]: value });
  };

  const catalog = [
    // Themes
    { type: 'theme', value: 'neutral', name: names.neutral, cost: 0 },
    { type: 'theme', value: 'cutesy', name: names.cutesy, cost: 50 },
    { type: 'theme', value: 'minimalist', name: names.minimalist, cost: 50 },
    { type: 'theme', value: 'cyberpunk', name: names.cyberpunk, cost: 100 },
    { type: 'theme', value: 'fantasy', name: names.fantasy, cost: 100 },
    { type: 'theme', value: 'corporate', name: names.corporate, cost: 25 },
    { type: 'theme', value: 'victorian', name: names.victorian, cost: 120 },
    { type: 'theme', value: 'wonderland', name: names.wonderland, cost: 150 },
    { type: 'theme', value: 'steampunk', name: names.steampunk, cost: 120 },
    { type: 'theme', value: 'enchanted', name: names.enchanted, cost: 130 },
    { type: 'theme', value: 'cosmic', name: names.cosmic, cost: 140 },
    { type: 'theme', value: 'retro', name: names.retro, cost: 80 },
    
    // Effects
    { type: 'effect', value: 'none', name: names.none, cost: 0 },
    { type: 'effect', value: 'confetti', name: names.confetti, cost: 30 },
    { type: 'effect', value: 'fireworks', name: names.fireworks, cost: 50 },
    { type: 'effect', value: 'sparkles', name: names.sparkles, cost: 40 },
    { type: 'effect', value: 'wave', name: names.wave, cost: 30 },
    { type: 'effect', value: 'shake', name: names.shake, cost: 20 },
  ];

  return (
    <div className="space-y-6">
      {/* Wallet Header */}
      {rewardsEnabled && (
        <div className="app-card p-6 flex flex-col items-center justify-center space-y-2">
          <h2 className="text-xl font-bold app-muted">{t('Your Balance')}</h2>
          <div className="text-5xl font-black text-yellow-500 flex items-center">
            🪙 {wallet.coin_balance}
          </div>
        </div>
      )}

      {cosmeticsUnlockedForAll && (
        <div className="app-card p-3 text-sm text-center app-chip-good app-radius">
          {t('An admin unlocked every theme and effect for everyone — equip whatever you like, free.')}
        </div>
      )}

      {/* Tabs */}
      {rewardsEnabled && (
        <div className="flex space-x-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <button 
            onClick={() => setActiveTab('group')}
            className={`flex-1 flex items-center justify-center py-2 rounded-md font-semibold transition ${activeTab === 'group' ? 'app-surface shadow-sm' : 'text-gray-500'}`}
          >
            <Gift size={18} className="mr-2" /> {t('Group Rewards')}
          </button>
          <button 
            onClick={() => setActiveTab('cosmetics')}
            className={`flex-1 flex items-center justify-center py-2 rounded-md font-semibold transition ${activeTab === 'cosmetics' ? 'app-surface shadow-sm' : 'text-gray-500'}`}
          >
            <Palette size={18} className="mr-2" /> {t('App Cosmetics')}
          </button>
        </div>
      )}

      {/* Group Rewards */}
      {activeTab === 'group' && rewardsEnabled && (
        <div className="space-y-4">
          {isAdmin && (
            <button onClick={() => setShowAddModal(true)} className="app-btn w-full py-3 app-surface border-2 border-dashed app-border flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Plus size={20} className="mr-2" /> {t('Add New Group Reward')}
            </button>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rewards.map(r => (
              <div key={r.id} className="app-card overflow-hidden flex flex-col">
                <div className={`p-6 text-center bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center`}>
                  <div className="text-5xl mb-2"><IconGlyph icon={r.icon} size={48} /></div>
                  <h3 className="font-bold text-lg dark:text-white">{r.name}</h3>
                  {r.description && <p className="text-sm opacity-75 mt-1">{r.description}</p>}
                </div>
                <div className="p-4 flex items-center justify-between bg-white dark:bg-gray-900">
                  <div className="font-bold text-yellow-600 flex items-center">
                    🪙 {r.cost}
                  </div>
                  {wallet.coin_balance >= r.cost ? (
                    <button onClick={() => purchaseReward(r)} className="app-btn px-4 py-2 bg-yellow-500 text-white shadow-sm">{t('Redeem')}</button>
                  ) : (
                    <span className="text-sm text-gray-400 font-semibold">{t('Need {{count}} more', { count: r.cost - wallet.coin_balance })}</span>
                  )}
                </div>
              </div>
            ))}
            {rewards.length === 0 && (
              <div className="col-span-full p-8 text-center text-gray-500">
                {t('No group rewards created yet.')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cosmetics Shop */}
      {activeTab === 'cosmetics' && (
        <div className="space-y-8">
          {/* Themes */}
          <div>
            <h3 className="font-bold text-lg mb-4 flex items-center"><Palette size={20} className="mr-2"/> {t('UI Themes')}</h3>
            <div className="grid grid-cols-2 gap-4">
              {catalog.filter(c => c.type === 'theme').map(item => (
                <div key={item.value} className="app-card p-4 flex flex-col items-center text-center space-y-3">
                  <div className="w-16 h-16 rounded-full shadow-inner flex items-center justify-center" style={{ background: 'var(--bg)' }}>
                    ✨
                  </div>
                  <h4 className="font-semibold text-sm">{item.name}</h4>
                  
                  {isUnlocked(item.type, item.value) ? (
                    cosmetics.theme === item.value ? (
                      <span className="px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-bold">{t("Equipped")}</span>
                    ) : (
                      <button onClick={() => equipCosmetic(item.type, item.value)} className="app-btn px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">{t("Equip")}</button>
                    )
                  ) : (
                    <button onClick={() => purchaseCosmetic(item)} className="app-btn px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-bold w-full">
                      🪙 {item.cost}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Effects */}
          <div>
            <h3 className="font-bold text-lg mb-4 flex items-center"><Sparkles size={20} className="mr-2"/> {t('Completion Effects')}</h3>
            <div className="grid grid-cols-2 gap-4">
              {catalog.filter(c => c.type === 'effect').map(item => (
                <div key={item.value} className="app-card p-4 flex flex-col items-center text-center space-y-3">
                  <h4 className="font-semibold text-sm">{item.name}</h4>
                  
                  {isUnlocked(item.type, item.value) ? (
                    cosmetics.effect === item.value ? (
                      <span className="px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-bold">{t("Equipped")}</span>
                    ) : (
                      <button onClick={() => equipCosmetic(item.type, item.value)} className="app-btn px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">{t("Equip")}</button>
                    )
                  ) : (
                    <button onClick={() => purchaseCosmetic(item)} className="app-btn px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-bold w-full">
                      🪙 {item.cost}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Admin Add Reward Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="app-card p-6 w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold">{t('Create Group Reward')}</h2>
            <form onSubmit={handleCreateReward} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold mb-1">{t('Name')}</label>
                <input required className="app-input" value={newReward.name} onChange={e => setNewReward({...newReward, name: e.target.value})} placeholder={t('e.g. Trip to the movies')} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">{t('Cost (Coins)')}</label>
                <input type="number" required className="app-input" value={newReward.cost} onChange={e => setNewReward({...newReward, cost: parseInt(e.target.value)})} min="1" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">{t('Icon (emoji or photo)')}</label>
                <IconPicker value={newReward.icon} onChange={(v) => setNewReward({...newReward, icon: v})} groupId={group.id} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">{t('Background Color')}</label>
                <select className="app-input" value={newReward.color_theme} onChange={e => setNewReward({...newReward, color_theme: e.target.value})}>
                  <option value="teal">{t('Teal')}</option>
                  <option value="pink">{t('Pink')}</option>
                </select>
              </div>
              <div className="flex space-x-2 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="app-btn flex-1 py-2 bg-gray-200">{t('Cancel')}</button>
                <button type="submit" className="app-btn flex-1 py-2 app-accent-bg">{t('Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
