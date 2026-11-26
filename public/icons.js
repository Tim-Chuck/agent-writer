const paths = {
  nib: '<path d="m13 3 8 8-6 6-4 1-8 3 3-8 1-4z"/><path d="m3 21 7-7m3-11 8 8"/><circle cx="11.5" cy="12.5" r="1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  book: '<path d="M12 6C9 4 6 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1zm0 0v14"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  pencil: '<path d="m15 5 4 4M4 20l4-1 12-12-4-4L4 15z"/>',
  outline: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4m-6 4v-4h12v4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  brain: '<path d="M12 5a3 3 0 0 0-6 0v1a4 4 0 0 0-2 7 4 4 0 0 0 4 6c1 2 4 2 4-1m0-13a3 3 0 0 1 6 0v1a4 4 0 0 1 2 7 4 4 0 0 1-4 6c-1 2-4 2-4-1m0-13v13M7 9c1 1 1 2 0 3m10-3c-1 1-1 2 0 3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="m10 3 4 0 1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  sparkles: '<path d="M10 3c.8 5.8 2.2 7.2 8 8-5.8.8-7.2 2.2-8 8-.8-5.8-2.2-7.2-8-8 5.8-.8 7.2-2.2 8-8zM19 3v6m-3-3h6"/>',
  send: '<path d="m3 3 18 9-18 9 3-9zM6 12h15"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  person: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/>',
  pin: '<path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  box: '<path d="m12 3 8 4v10l-8 4-8-4V7zm-8 4 8 4 8-4m-8 4v10"/>',
  building: '<path d="M3 21h18M5 21V9l7-5 7 5v12m-10-8h6m-6 4h6m-3-7h.01"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  link: '<path d="M14 4h6v6m0-6-9 9m6 0v6H5V7h6"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  trash: '<path d="M4 7h16m-13 0 1 13h8l1-13M9 7V4h6v3m-5 4v5m4-5v5"/>',
  warning: '<path d="M12 3 2 20h20zM12 9v4m0 3h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  save: '<path d="M4 4h13l3 3v13H4zm4 0v6h8V4M8 20v-6h8v6"/>',
  clipboard: '<rect x="7" y="6" width="13" height="15" rx="2"/><path d="M16 6V3H4v14h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search: '<circle cx="10" cy="10" r="5"/><path d="m14 14 5 5"/>',
};

export function icon(name, size = 18) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.file}</svg>`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
