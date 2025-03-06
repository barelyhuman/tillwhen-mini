import { FastifyInstance } from 'fastify'
import { signup, login } from '../controllers/authController.js'

export default async function (fastify: FastifyInstance) {
  fastify.post('/signup', signup)
  fastify.post('/login', login)
}
