export const formatDateTime = (date?: string) => {
    if (!date) return '';
    return new Date(date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
};
/** Date without the time — for dense surfaces (the agent rail) where the
 *  clock adds width without adding information. */
export const formatDate = (date?: string) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', { dateStyle: 'medium' });
};

/** Relative one-liner for inline meta ("card read 5 min ago") where the
 *  two-line DateTimeAgo would wrap; falls back to the plain date once the
 *  moment stops being news. Pair it with a formatDateTime tooltip. */
export const formatTimeAgo = (date?: string) => {
    if (!date) return '';
    const sec = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} d ago`;
    return formatDate(date);
};
