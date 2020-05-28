export default async (req, res) => {
  try {
    const discountService = req.scope.resolve("discountService")
    const data = await discountService.list()

    res.status(200).json({ discounts: data })
  } catch (err) {
    throw err
  }
}
