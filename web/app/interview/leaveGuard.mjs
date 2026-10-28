export const UNSAVED_MESSAGE = 'Your answer has not been saved. Leaving discards this page’s recording. Your pending question can be retrieved, but unsaved audio cannot. Leave practice?';
export const SUBMITTING_MESSAGE = 'Your recording is being submitted. Leaving loses the local recording and feedback view. The server may still save the answer; check History before retrying. Leave practice?';

export function installInterviewLeaveGuard({ window, document, shouldWarn, isSubmitting }) {
  function beforeUnload(event) {
    if (!shouldWarn()) return;
    event.preventDefault();
    event.returnValue = '';
  }
  function click(event) {
    if (!shouldWarn() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target?.closest?.('a[href], [data-leave-practice]');
    if (!element) return;
    if (element.matches('a[href]')) {
      if (element.target === '_blank' || element.hasAttribute('download')) return;
      const destination = new URL(element.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return;
    }
    if (!window.confirm(isSubmitting() ? SUBMITTING_MESSAGE : UNSAVED_MESSAGE)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('click', click, true);
  return () => {
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('click', click, true);
  };
}
