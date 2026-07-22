import { Router } from "express";
import { Prisma, prisma } from "@brfut/db";
import { comparePassword, hashPassword } from "../auth/hash.js";
import { signAccessToken } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { loginRateLimit, registerRateLimit } from "../middleware/authRateLimit.js";

export const authRouter = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function publicUser(user: { id: string; email: string; username: string }) {
  return { id: user.id, email: user.email, username: user.username };
}

authRouter.post(
  "/register",
  registerRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password, username } = req.body ?? {};

    if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    if (typeof username !== "string" || username.trim().length < 3) {
      res.status(400).json({ error: "Username must be at least 3 characters" });
      return;
    }

    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing) {
      res.status(409).json({ error: "Email or username already in use" });
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({ data: { email, passwordHash, username } });
      const token = signAccessToken({ sub: user.id, email: user.email, username: user.username });
      res.status(201).json({ token, user: publicUser(user) });
    } catch (err) {
      // Safety net for a race between the findFirst check above and this
      // create (two registrations for the same email landing concurrently).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "Email or username already in use" });
        return;
      }
      throw err;
    }
  })
);

authRouter.post(
  "/login",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordMatches = user ? await comparePassword(password, user.passwordHash) : false;

    if (!user || !passwordMatches) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signAccessToken({ sub: user.id, email: user.email, username: user.username });
    res.json({ token, user: publicUser(user) });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: publicUser(user) });
  })
);
