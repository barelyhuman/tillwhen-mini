import { signup, login } from '../controllers/authController.js'

export default async function (fastify) {
  fastify.post('/signup', signup)
  fastify.post('/login', login)
}
