"use client";

import {useEffect, useId, useRef, useState} from "react";
import {createPortal} from "react-dom";
import styles from "./HistoryBadge.module.css";

// Portal keeps details outside clipping cards. Native button supports touch/keyboard.
export default function HistoryBadge({children, details, style, label}) {
  const id = useId();
  const trigger = useRef(null);
  const popup = useRef(null);
  const [position, setPosition] = useState(null);
  const pinned = useRef(false);
  const leaveTimer = useRef(null);
  const cancelLeave = () => clearTimeout(leaveTimer.current);
  const leave = () => { if (!pinned.current) leaveTimer.current = setTimeout(() => setPosition(null), 150); };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const close = () => { cancelLeave(); pinned.current = false; setPosition(null); };
  const show = () => {
    cancelLeave();
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const down = below >= 170 || below >= above;
    setPosition({width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(down ? {top: rect.bottom + 8} : {bottom: window.innerHeight - rect.top + 8}),
      maxHeight: Math.max(40, (down ? below : above) - 20)});
  };
  useEffect(() => {
    if (!position) return;
    const outside = event => {
      if (!trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) close();
    };
    const escape = event => { if (event.key === "Escape") close(); };
    const scroll = event => { if (!popup.current?.contains(event.target)) close(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [position]);
  return <>
    <button ref={trigger} type="button" className={styles.trigger} style={style}
      aria-label={label} aria-expanded={!!position} aria-describedby={position ? id : undefined}
      onPointerEnter={event => { if (event.pointerType === "mouse") show(); }}
      onPointerLeave={leave}
      onFocus={show} onBlur={close}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}>
      {children}
    </button>
    {position && createPortal(<div id={id} ref={popup} role="tooltip" className={styles.popup} style={position}
      onPointerEnter={cancelLeave} onPointerLeave={leave}>
      {details.map((line, i) => <div key={i}>{line}</div>)}
    </div>, document.body)}
  </>;
}
