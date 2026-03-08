import { useEffect } from 'react';
import { useApp } from '../../context/AppContext';

export default function StatsBar({ filtered }) {
  const { contacts } = useApp();

  const total     = filtered.length;
  const offers    = contacts.filter(c => c.status === 'Offer Made').length;
  const uc        = contacts.filter(c => c.status === 'UC').length;
  const closed    = contacts.filter(c => c.status === 'Closed').length;

  useEffect(() => {
    const bar = document.getElementById('statsBar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="stat-pill"><span class="stat-num">${total}</span><span class="stat-label">total</span></div>
      <div class="stat-divider"></div>
      <div class="stat-pill"><span class="stat-num" style="color:var(--warning)">${offers}</span><span class="stat-label">offers</span></div>
      <div class="stat-divider"></div>
      <div class="stat-pill"><span class="stat-num" style="color:var(--accent)">${uc}</span><span class="stat-label">under contract</span></div>
      <div class="stat-divider"></div>
      <div class="stat-pill"><span class="stat-num" style="color:var(--success)">${closed}</span><span class="stat-label">closed</span></div>
    `;
  }, [total, offers, uc, closed]);

  return null;
}