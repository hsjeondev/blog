import IonIcon from "../Icon";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import type { ForestSort } from "../../utils/forest-navigation";

const options: { value: ForestSort; label: string }[] = [
  { value: "title-asc", label: "이름순" },
  { value: "edited-desc", label: "최근 수정순" },
  { value: "edited-asc", label: "오래된 수정순" },
  { value: "created-desc", label: "최근 생성순" },
];
export function ForestSortMenu({ value, onChange }: { value: ForestSort; onChange: (value: ForestSort) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div className="forest-sort-menu" ref={rootRef}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    }}>
    <button ref={triggerRef} type="button" className="forest-icon-button" aria-label={`정렬: ${options.find((option) => option.value === value)?.label}`}
      title="문서 정렬" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      <IonIcon name="swap-vertical-outline" />
    </button>
    {open && <motion.div ref={menuRef} id={menuId} role="menu" aria-label="문서 정렬 방식" className="header-theme-dropdown forest-sort-dropdown"
      initial={{ opacity: reducedMotion ? 1 : 0, scale: reducedMotion ? 1 : .95, y: reducedMotion ? 0 : -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : .15 }}
      onKeyDown={(event) => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
      }}>
      {options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value}
        className={`header-theme-option${option.value === value ? " is-active" : ""}`} onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}>
        <span>{option.label}</span>{option.value === value && <IonIcon name="checkmark-outline" aria-hidden="true" />}
      </button>)}
    </motion.div>}
  </div>;
}
