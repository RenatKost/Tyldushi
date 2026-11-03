// Fixed list of help categories. Keys are stored in the DB, labels are shown in the UI.
export const CATEGORIES = [
    { key: 'military', label: 'Допомога військовим', icon: 'fa-shield-halved' },
    { key: 'idp', label: 'Внутрішньо переміщені особи', icon: 'fa-house-chimney-user' },
    { key: 'humanitarian', label: 'Гуманітарна допомога', icon: 'fa-box-open' },
    { key: 'medical', label: 'Медична допомога', icon: 'fa-briefcase-medical' },
    { key: 'children', label: 'Діти та сім\'ї', icon: 'fa-children' },
    { key: 'veterans', label: 'Ветерани та їх родини', icon: 'fa-medal' },
    { key: 'psychological', label: 'Психологічна підтримка', icon: 'fa-hand-holding-heart' },
    { key: 'rehabilitation', label: 'Реабілітація', icon: 'fa-wheelchair' },
    { key: 'elderly', label: 'Літні люди', icon: 'fa-person-cane' },
    { key: 'disability', label: 'Люди з інвалідністю', icon: 'fa-universal-access' },
    { key: 'animals', label: 'Тварини', icon: 'fa-paw' },
    { key: 'education', label: 'Освіта', icon: 'fa-graduation-cap' },
    { key: 'legal', label: 'Юридична допомога', icon: 'fa-scale-balanced' },
    { key: 'housing', label: 'Житло та відбудова', icon: 'fa-house' },
    { key: 'community', label: 'Громада та культура', icon: 'fa-people-group' },
    { key: 'ecology', label: 'Екологія', icon: 'fa-seedling' },
];

export const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

export function normalizeCategories(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter(k => CATEGORY_KEYS.includes(k)))];
}
