'use client';

// ════════════════════════════════════════════════════════════════════════════
// useUrlTab — har internal tab / sub-view ko ek shareable URL deta hai.
// ────────────────────────────────────────────────────────────────────────────
// MASLA jo ye solve karta hai:
//   Pehle har page ke andar tabs (HR → Salary, Accounts → Vendors, Settings →
//   Store waghera) sirf React state mein the. URL hamesha /hr ya /accounts hi
//   rehta tha. Matlab agar aap kisi ko link bhejte to wo by-default pehle tab
//   par land karta — exact tab share nahi ho sakta tha.
//
//   Ab tab badalne par URL mein `?tab=salary` jaisa param lag jata hai, aur
//   jab koi wo link kholta hai to wahi tab apne aap open hota hai. Bilkul
//   "kisi ko bhejun to kaam ho sake" wali requirement.
//
// KAISE: ye hook bilkul useState ki tarah `[value, setValue]` return karta hai,
//   to existing code mein sirf 1 line badalni hoti hai:
//       const [tab, setTab] = useState('salary');
//   ko
//       const [tab, setTab] = useUrlTab('tab', 'salary');
//
// BUILD-SAFE: ye `useSearchParams` use NAHI karta (jo Next.js mein Suspense
//   boundary maangta hai aur build tod sakta hai). Iske bajaye URL ko
//   `window.location` + `history.replaceState` se padhta/likhta hai — purely
//   client-side, koi prerender error nahi. Page load par ek tick baad URL se
//   value sync ho jati hai (loading spinner ke peeche, nazar bhi nahi aata).
//
// PARAM key alag rakhi ja sakti hai (e.g. 'tab', 'view', 'order') taake ek hi
//   page par multiple cheezein independently URL mein reflect ho saken.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react';

export function useUrlTab(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);
  // defaultValue badle (e.g. permission-filtered defaultTab) to bhi sahi rahe —
  // lekin URL param ko hamesha priority do.
  const initializedRef = useRef(false);

  // ── On mount: URL se param padho (sirf client par chalta hai → build-safe) ──
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get(key);
      if (fromUrl != null && fromUrl !== '') {
        setValue(fromUrl);
      }
    } catch (_) {
      /* SSR ya purana browser — chup-chaap default par reh jao */
    }
    initializedRef.current = true;
    // sirf mount par — key/default change par dobara mount-read nahi chahiye
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Setter: state + URL dono update karo (page reload ke bina) ──
  const set = useCallback((next) => {
    // functional updater support (setTab(prev => ...))
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try {
        const url = new URL(window.location.href);
        if (resolved == null || resolved === '' || resolved === defaultValue) {
          // default par wapas aaye to URL saaf rakho (clean links)
          url.searchParams.delete(key);
        } else {
          url.searchParams.set(key, String(resolved));
        }
        window.history.replaceState(window.history.state, '', url.toString());
      } catch (_) {
        /* ignore — state to update ho hi chuka hai */
      }
      return resolved;
    });
  }, [key, defaultValue]);

  return [value, set];
}

// ════════════════════════════════════════════════════════════════════════════
// useUrlParam — generic version (e.g. detail drawer ke liye `?order=ZEVAR-123`).
// useUrlTab jaisa hi hai bas default '' (empty) hota hai aur empty par param
// hata deta hai. List pages mein "kaunsa item khula hai" share karne ke liye.
// ════════════════════════════════════════════════════════════════════════════
export function useUrlParam(key, defaultValue = '') {
  return useUrlTab(key, defaultValue);
}
