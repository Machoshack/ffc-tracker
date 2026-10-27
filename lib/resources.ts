// Programs shown in Resources, and the tools built into Waypoint for each.
export const RESOURCE_PROGRAMS = [
  { code: 'TS', label: 'Two-Step' },
  { code: 'FHE', label: 'FHE' },
  { code: 'P1', label: 'Protocol I' },
  { code: 'P2', label: 'Protocol II' },
] as const;

export const BUILT_IN_TOOLS: Record<string, { href: string; label: string; note: string }[]> = {
  FHE: [{
    href: '/resources/FHE/cover-sheet', label: 'FHE cover sheet generator',
    note: 'Enter scores and notes, then print or save as PDF. Nothing typed into it is saved.',
  }],
  P1: [{
    href: '/resources/P1/margin', label: 'P1 margin',
    note: 'Fee, costs and remaining budgets for each Protocol I patient.',
  }],
};
