import { subscriptionFocusTarget } from './subscription-login-state.js';

/** Replace only the subscription controls and restore focus to the next useful step. */
export function updateSubscriptionCard(card, subscription, state, document = globalThis.document) {
  const active = document?.activeElement;
  const previous = active && card.contains(active) ? active.getAttribute('data-subscription-focus') : null;
  card.querySelector('[data-subscription-action]').innerHTML = subscription.action;
  card.querySelector('[data-subscription-panel]').innerHTML = subscription.panel;
  const target = subscriptionFocusTarget(previous, state);
  if (target) card.querySelector(`[data-subscription-focus="${target}"]`)?.focus();
}
