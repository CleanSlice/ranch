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
