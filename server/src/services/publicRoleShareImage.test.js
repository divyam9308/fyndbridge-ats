const test = require('node:test')
const assert = require('node:assert/strict')
const { loadImage } = require('@napi-rs/canvas')
const { HEIGHT, WIDTH, renderPublicRoleShareImage } = require('./publicRoleShareImage')

test('renders a social preview JPEG with dynamic public role details at 1200 by 630', async () => {
  const buffer = await renderPublicRoleShareImage({
    public_name: 'Dean - Executive Education',
    public_location: 'Jaipur',
    public_experience: '10-15 Years'
  })

  assert.equal(buffer.subarray(0, 3).toString('hex'), 'ffd8ff')
  const image = await loadImage(buffer)
  assert.equal(image.width, WIDTH)
  assert.equal(image.height, HEIGHT)
})
