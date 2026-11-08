import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import CompletionEffects from '../components/CompletionEffects';

const CosmeticsContext = createContext({
  cosmetics: {
    theme: 'neutral',
    mode: 'light',
    font: null,
    effect: 'none',
    primaryColor: null,
    accentColor: null
  },
  setCosmetics: () => {},
  triggerEffect: () => {},
});

export const CosmeticsProvider = ({ children, groupId, activeCosmetics }) => {
  const [cosmetics, setCosmeticsState] = useState({
    theme: 'neutral',
    mode: 'light',
    font: null,
    effect: 'none',
    primaryColor: null,
    accentColor: null,
    ...activeCosmetics
  });
  
  const [showEffect, setShowEffect] = useState(false);

  // Sync state changes to DOM
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', cosmetics.theme || 'neutral');
    root.setAttribute('data-mode', cosmetics.mode || 'light');
    
    if (cosmetics.primaryColor) {
      root.style.setProperty('--custom-primary', cosmetics.primaryColor);
    } else {
      root.style.removeProperty('--custom-primary');
    }

    if (cosmetics.accentColor) {
      root.style.setProperty('--custom-accent', cosmetics.accentColor);
    } else {
      root.style.removeProperty('--custom-accent');
    }

    if (cosmetics.font) {
      root.style.setProperty('--font', cosmetics.font);
    } else {
      root.style.removeProperty('--font');
    }
  }, [cosmetics]);

  const setCosmetics = async (newCosmetics) => {
    const updated = { ...cosmetics, ...newCosmetics };
    setCosmeticsState(updated);
    
    if (groupId) {
      await supabase.rpc('update_active_cosmetics', {
        p_group_id: groupId,
        p_active_cosmetics: updated
      });
    }
  };

  const triggerEffect = () => {
    if (cosmetics.effect && cosmetics.effect !== 'none') {
      setShowEffect(true);
    }
  };

  return (
    <CosmeticsContext.Provider value={{ cosmetics, setCosmetics, triggerEffect }}>
      {children}
      <CompletionEffects effect={cosmetics.effect} visible={showEffect} onComplete={() => setShowEffect(false)} />
    </CosmeticsContext.Provider>
  );
};

export const useCosmetics = () => useContext(CosmeticsContext);
