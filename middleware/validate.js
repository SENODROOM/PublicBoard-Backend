const VALID_CATEGORIES = [
  "Infrastructure", "Safety", "Sanitation",
  "Community Resources", "Environment", "Transportation", "Other",
];
const VALID_PRIORITIES = ["Low", "Medium", "High", "Critical"];

/**
 * Validates POST /api/issues request body.
 * Returns 400 with a clear message on failure.
 */
function validateIssue(req, res, next) {
  const { title, description, category, location } = req.body;

  if (!title || typeof title !== "string" || title.trim().length < 5)
    return res.status(400).json({ message: "Title must be at least 5 characters" });
  if (title.trim().length > 200)
    return res.status(400).json({ message: "Title must be under 200 characters" });

  if (!description || typeof description !== "string" || description.trim().length < 20)
    return res.status(400).json({ message: "Description must be at least 20 characters" });
  if (description.trim().length > 2000)
    return res.status(400).json({ message: "Description must be under 2000 characters" });

  if (!category || !VALID_CATEGORIES.includes(category))
    return res.status(400).json({ message: `Category must be one of: ${VALID_CATEGORIES.join(", ")}` });

  if (!location || typeof location !== "string" || location.trim().length < 3)
    return res.status(400).json({ message: "Location must be at least 3 characters" });
  if (location.trim().length > 200)
    return res.status(400).json({ message: "Location must be under 200 characters" });

  if (req.body.priority && !VALID_PRIORITIES.includes(req.body.priority))
    return res.status(400).json({ message: `Priority must be one of: ${VALID_PRIORITIES.join(", ")}` });

  if (req.body.tags) {
    if (!Array.isArray(req.body.tags))
      return res.status(400).json({ message: "Tags must be an array" });
    if (req.body.tags.length > 10)
      return res.status(400).json({ message: "Maximum 10 tags allowed" });
  }

  next();
}

/**
 * Validates donation creation body.
 */
function validateDonation(req, res, next) {
  const { amount, name, email } = req.body;
  const amt = parseFloat(amount);

  if (!amount || isNaN(amt) || amt < 1)
    return res.status(400).json({ message: "Minimum donation is $1" });
  if (amt > 10000)
    return res.status(400).json({ message: "Maximum donation is $10,000 per transaction" });
  if (!name || name.trim().length < 2)
    return res.status(400).json({ message: "Name must be at least 2 characters" });
  if (!email || !/^\S+@\S+\.\S+$/.test(email))
    return res.status(400).json({ message: "Valid email is required" });

  next();
}

module.exports = { validateIssue, validateDonation };