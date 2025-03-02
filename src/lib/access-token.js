import crc32 from 'crc/crc32'
import crypto from 'crypto'

export function generateToken(length = 32) {
  const randomBytes = crypto.randomBytes(length)
  const baseToken = randomBytes.toString('base64url')
  const checksum = crc32(baseToken).toString(16).padStart(8, '0')
  const token = `oat_${baseToken}_${checksum}`
  const hash = crypto.createHash('sha256').update(token).digest('hex')

  return {
    token,
    hash,
  }
}

export function verifyToken(token, storedHash) {
  const computedHash = crypto.createHash('sha256').update(token).digest('hex')
  return computedHash === storedHash
}
