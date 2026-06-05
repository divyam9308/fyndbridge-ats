async function me(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  return res.json({ user: req.user })
}

module.exports = { me }
