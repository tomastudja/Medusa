import { IdMap } from "medusa-test-utils"

export const TotalsServiceMock = {
  getSubtotal: jest.fn().mockImplementation(cart => {
    if (cart.subtotal) {
      return cart.subtotal
    }
    if (cart._id === IdMap.getId("discount-cart")) {
      return 280
    }
    return 0
  }),
}

const mock = jest.fn().mockImplementation(() => {
  return TotalsServiceMock
})

export default mock
