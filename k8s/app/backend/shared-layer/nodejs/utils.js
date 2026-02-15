exports.validateOrder = (order) => {
  if (!order.items || !Array.isArray(order.items) || order.items.length === 0) {
    return { isValid: false, message: "Order must contain at least one item" };
  }
  if (!order.totalAmount || order.totalAmount <= 0) {
    return { isValid: false, message: "Total amount must be positive" };
  }
  return { isValid: true };
};
