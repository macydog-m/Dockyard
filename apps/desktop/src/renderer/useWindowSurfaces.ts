import { useLayoutEffect, type RefObject } from 'react';

/** Keep native hit regions aligned with visible UI, including dynamically sized dialogs. */
export function useWindowSurfaces(root: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const shell = root.current;
    if (!shell) return;
    let frame = 0;
    let previous = '';
    let disposed = false;
    const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
    const contrast = matchMedia('(forced-colors: active)');
    const stopMaterial = window.dockyard.onMaterialChange(mode => { document.documentElement.dataset.material = mode; });
    const measure = () => {
      const panel = [...shell.querySelectorAll<HTMLElement>('.popover')].find(element => element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden');
      const feedback = shell.querySelector<HTMLElement>('.feedback');
      if (feedback) {
        const top = panel && getComputedStyle(panel).visibility !== 'hidden' ? panel.getBoundingClientRect().bottom + 8 : (shell.querySelector('.dock-bar')?.getBoundingClientRect().bottom ?? 54) + 8;
        const position = `${Math.round(Math.min(top, innerHeight - feedback.offsetHeight - 8))}px`;
        if (feedback.style.top !== position) feedback.style.top = position;
      }
      const surfaces = [...shell.querySelectorAll<HTMLElement>('.dock-bar, .popover, .feedback, dialog[open]')]
        .filter(element => getComputedStyle(element).visibility !== 'hidden')
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)),
            width: Math.min(innerWidth, Math.round(rect.width)), height: Math.min(innerHeight, Math.round(rect.height)),
            radius: Math.round(parseFloat(getComputedStyle(element).borderTopLeftRadius)) };
        }).filter(rect => rect.width > 0 && rect.height > 0);
      const key = JSON.stringify(surfaces);
      if (!surfaces.length || key === previous) return;
      previous = key;
      void window.dockyard.setSurfaces(surfaces).then(mode => {
        if (!disposed) document.documentElement.dataset.material = mode;
      }).catch(() => { if (!disposed) document.documentElement.dataset.material = 'solid'; });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const sizes = new ResizeObserver(schedule);
    const observeSurfaces = () => {
      sizes.disconnect();
      shell.querySelectorAll('.dock-bar, .popover, .feedback, dialog').forEach(element => sizes.observe(element));
      schedule();
    };
    const changes = new MutationObserver(observeSurfaces);
    changes.observe(shell, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open', 'hidden'] });
    const themeChanged = () => { previous = ''; schedule(); };
    reduced.addEventListener('change', themeChanged);
    contrast.addEventListener('change', themeChanged);
    window.addEventListener('resize', schedule);
    observeSurfaces();
    return () => {
      disposed = true; cancelAnimationFrame(frame); sizes.disconnect(); changes.disconnect();
      reduced.removeEventListener('change', themeChanged); contrast.removeEventListener('change', themeChanged);
      window.removeEventListener('resize', schedule);
      stopMaterial();
    };
  }, [root]);
}
