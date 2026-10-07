import { always, eventually, state, when } from '../../src/rules.ts'

export const emptyCartDisablesOrder = always(
  when(() => state.node.is('/cart.html') && state.read('cart.count') === 0).then(() => state.element('cart.order').disabled),
)

export const errorToastClears = always(
  when(() => state.element('cart.toast').visible).then(eventually(() => !state.element('cart.toast').visible).within(5, 'seconds')),
)

export const savedToastClears = always(
  when(() => state.element('cart.saved').visible).then(eventually(() => !state.element('cart.saved').visible).within(5, 'seconds')),
)

export const countNeverNegative = always(() => ((state.read('cart.count') as number | undefined) ?? 0) >= 0)
