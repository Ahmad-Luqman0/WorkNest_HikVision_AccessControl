// Single source of truth for Hikvision access_event_category codes
// (the protocol's "minor" event type). Used by the API responses, and
// mirrored into dbo.WN_HIK_EventCategories at startup so SQL queries can
// JOIN to a readable label:
//
//   SELECT e.*, c.label
//   FROM WN_HIK_Events e
//   LEFT JOIN WN_HIK_EventCategories c ON c.code = e.access_event_category
//
// Add new codes here — the DB table updates itself on the next start/deploy.
export const ACCESS_EVENT_CATEGORY_MAPPING = {
  1: { label: 'Entry authorized', denied: false },
  2: { label: 'Card + password', denied: false },
  21: { label: 'Door opened', denied: false },
  22: { label: 'Door closed', denied: false },
  23: { label: 'Door open timeout', denied: true },
  27: { label: 'Remote unlock (dashboard)', denied: false },
  38: { label: 'Fingerprint OK', denied: false },
  39: { label: 'Fingerprint denied', denied: true },
  75: { label: 'Face OK', denied: false },
  76: { label: 'Face not recognized', denied: true },
  112: { label: 'Entry denied (expired)', denied: true },
  // Codes observed in the field on this fleet:
  8: { label: 'Card verify failed', denied: false },
  9: { label: 'Unregistered card', denied: true },
  24: { label: 'Door forced open (alarm)', denied: false },
  104: { label: 'Face recognition failed', denied: true },
  151: { label: 'Machine event 151', denied: false },
};

export const categoryLabel = (code) =>
  ACCESS_EVENT_CATEGORY_MAPPING[Number(code)]?.label || `Event ${code}`;

export const isDeniedCategory = (code) =>
  !!ACCESS_EVENT_CATEGORY_MAPPING[Number(code)]?.denied;
