export const formatDateTime = (date?: string) => {
    if (!date) return '';
    return new Date(date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
};