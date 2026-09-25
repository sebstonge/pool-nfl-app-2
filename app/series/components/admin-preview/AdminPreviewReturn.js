'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { isPreviewAdmin } from './previewAdmin.mjs';
import styles from './preview.module.css';

export default function AdminPreviewReturn({client=supabase}) {
  const [admin,setAdmin]=useState(false);
  useEffect(()=>{
    let active=true, generation=0;
    async function check() {
      const current=++generation;
      setAdmin(false);
      const allowed=await isPreviewAdmin(client);
      if(active&&current===generation)setAdmin(allowed);
    }
    check();
    // Schedule outside Supabase's auth callback to avoid nested auth calls.
    const {data:{subscription}}=client.auth.onAuthStateChange(()=>{
      ++generation;setAdmin(false);
      Promise.resolve().then(()=>{if(active)check();});
    });
    return()=>{active=false;++generation;subscription.unsubscribe();};
  },[client]);
  if(!admin)return null;
  return <aside className={styles.banner} aria-label="Aperçu Séries réservé à l’Admin">
    <strong>Aperçu Séries · Admin</strong>
    <nav aria-label="Navigation de l’aperçu Admin">
      <a href="/admin">← Retour au mode régulier</a>
      <a href="/admin/playoffs">Admin Séries</a>
      <a href="/series/matchs">Mes choix Séries</a>
      <a href="/series/tous-les-choix">Tous les choix Séries</a>
    </nav>
  </aside>;
}
