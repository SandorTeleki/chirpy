import express, { Request, Response, NextFunction } from "express";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { config } from "./config.js";
import { AppError, BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from "./errors.js";
import { createUser, deleteAllUsers, getUserByEmail, updateUser, upgradeToChirpyRed } from "./db/queries/users.js";
import { createChirp, getAllChirps, getChirpById, deleteChirp } from "./db/queries/chirps.js";
import { hashPassword, checkPasswordHash, makeJWT, validateJWT, getBearerToken, makeRefreshToken, getAPIKey } from "./auth.js";
import { createRefreshToken, getRefreshToken, revokeRefreshToken } from "./db/queries/refreshTokens.js";

const migrationClient = postgres(config.db.url, { max: 1 });
await migrate(drizzle(migrationClient), config.db.migrationConfig);

const app = express();
const PORT = 8080;

function middlewareLogResponses(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    const statusCode = res.statusCode;
    if (statusCode >= 400) {
      console.log(`[NON-OK] ${req.method} ${req.url} - Status: ${statusCode}`);
    }
  });
  next();
}

function middlewareMetricsInc(req: Request, res: Response, next: NextFunction) {
  config.fileserverHits++;
  next();
}

function handlerReadiness(req: Request, res: Response) {
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send("OK");
}

function handlerMetrics(req: Request, res: Response) {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<html>
  <body>
    <h1>Welcome, Chirpy Admin</h1>
    <p>Chirpy has been visited ${config.fileserverHits} times!</p>
  </body>
</html>`);
}

function handlerReset(req: Request, res: Response, next: NextFunction) {
  if (config.platform !== "dev") {
    next(new ForbiddenError("Forbidden"));
    return;
  }
  deleteAllUsers()
    .then(() => {
      config.fileserverHits = 0;
      res.set("Content-Type", "text/plain; charset=utf-8");
      res.send("OK");
    })
    .catch(next);
}

async function handlerCreateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email) {
      throw new BadRequestError("Email is required");
    }
    if (!password) {
      throw new BadRequestError("Password is required");
    }
    const hashedPassword = await hashPassword(password);
    const user = await createUser({ email, hashedPassword });
    if (!user) {
      throw new BadRequestError("User already exists");
    }
    res.status(201).json({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      isChirpyRed: user.isChirpyRed,
    });
  } catch (err) {
    next(err);
  }
}

async function handlerUpdateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);
    const userId = validateJWT(token, config.jwtSecret);

    const { email, password } = req.body;
    if (!email || !password) {
      throw new BadRequestError("Email and password are required");
    }
    const hashedPassword = await hashPassword(password);
    const user = await updateUser(userId, email, hashedPassword);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    res.status(200).json({
      id: user.id,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      email: user.email,
      isChirpyRed: user.isChirpyRed,
    });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new UnauthorizedError("Unauthorized"));
    }
  }
}

async function handlerLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new UnauthorizedError("incorrect email or password");
    }
    const user = await getUserByEmail(email);
    if (!user) {
      throw new UnauthorizedError("incorrect email or password");
    }
    const valid = await checkPasswordHash(password, user.hashedPassword);
    if (!valid) {
      throw new UnauthorizedError("incorrect email or password");
    }
    const token = makeJWT(user.id, 3600, config.jwtSecret);
    const refreshToken = makeRefreshToken();
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days
    await createRefreshToken(refreshToken, user.id, expiresAt);
    res.status(200).json({
      id: user.id,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      email: user.email,
      isChirpyRed: user.isChirpyRed,
      token,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

async function handlerRefresh(req: Request, res: Response, next: NextFunction) {
  try {
    const tokenString = getBearerToken(req);
    const storedToken = await getRefreshToken(tokenString);
    if (!storedToken) {
      throw new UnauthorizedError("Unauthorized");
    }
    if (storedToken.revokedAt) {
      throw new UnauthorizedError("Unauthorized");
    }
    if (new Date() > storedToken.expiresAt) {
      throw new UnauthorizedError("Unauthorized");
    }
    const token = makeJWT(storedToken.userId, 3600, config.jwtSecret);
    res.status(200).json({ token });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new UnauthorizedError("Unauthorized"));
    }
  }
}

async function handlerRevoke(req: Request, res: Response, next: NextFunction) {
  try {
    const tokenString = getBearerToken(req);
    await revokeRefreshToken(tokenString);
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new UnauthorizedError("Unauthorized"));
    }
  }
}

async function handlerGetChirps(req: Request, res: Response, next: NextFunction) {
  try {
    let authorId = "";
    const authorIdQuery = req.query.authorId;
    if (typeof authorIdQuery === "string") {
      authorId = authorIdQuery;
    }
    const sortQuery = req.query.sort;
    const sortOrder = sortQuery === "desc" ? "desc" : "asc";

    const allChirps = await getAllChirps(authorId || undefined);
    const mapped = allChirps.map((chirp) => ({
      id: chirp.id,
      createdAt: chirp.createdAt.toISOString(),
      updatedAt: chirp.updatedAt.toISOString(),
      body: chirp.body,
      userId: chirp.userId,
    }));
    if (sortOrder === "desc") {
      mapped.reverse();
    }
    res.status(200).json(mapped);
  } catch (err) {
    next(err);
  }
}

async function handlerGetChirpById(req: Request, res: Response, next: NextFunction) {
  try {
    const chirp = await getChirpById(req.params.chirpId as string);
    if (!chirp) {
      throw new NotFoundError("Chirp not found");
    }
    res.status(200).json({
      id: chirp.id,
      createdAt: chirp.createdAt.toISOString(),
      updatedAt: chirp.updatedAt.toISOString(),
      body: chirp.body,
      userId: chirp.userId,
    });
  } catch (err) {
    next(err);
  }
}

async function handlerCreateChirp(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);
    const userId = validateJWT(token, config.jwtSecret);

    const { body } = req.body;
    if (!body) {
      throw new BadRequestError("Body is required");
    }
    if (body.length > 140) {
      throw new BadRequestError("Chirp is too long. Max length is 140");
    }
    const profaneWords = ["kerfuffle", "sharbert", "fornax"];
    const cleanedBody = body
      .split(" ")
      .map((word: string) =>
        profaneWords.includes(word.toLowerCase()) ? "****" : word
      )
      .join(" ");
    const chirp = await createChirp({ body: cleanedBody, userId });
    res.status(201).json({
      id: chirp.id,
      createdAt: chirp.createdAt.toISOString(),
      updatedAt: chirp.updatedAt.toISOString(),
      body: chirp.body,
      userId: chirp.userId,
    });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new UnauthorizedError("Unauthorized"));
    }
  }
}

async function handlerDeleteChirp(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);
    const userId = validateJWT(token, config.jwtSecret);

    const chirp = await getChirpById(req.params.chirpId as string);
    if (!chirp) {
      throw new NotFoundError("Chirp not found");
    }
    if (chirp.userId !== userId) {
      throw new ForbiddenError("Forbidden");
    }
    await deleteChirp(chirp.id);
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new UnauthorizedError("Unauthorized"));
    }
  }
}

async function handlerPolkaWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = getAPIKey(req);
    if (apiKey !== config.polkaKey) {
      throw new UnauthorizedError("Unauthorized");
    }
    const { event, data } = req.body;
    if (event !== "user.upgraded") {
      res.sendStatus(204);
      return;
    }
    const user = await upgradeToChirpyRed(data.userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new UnauthorizedError("Unauthorized"));
    }
  }
}

app.use(middlewareLogResponses);
app.use(express.json());

app.get("/api/healthz", handlerReadiness);
app.post("/api/users", handlerCreateUser);
app.put("/api/users", handlerUpdateUser);
app.post("/api/login", handlerLogin);
app.post("/api/refresh", handlerRefresh);
app.post("/api/revoke", handlerRevoke);
app.get("/api/chirps", handlerGetChirps);
app.get("/api/chirps/:chirpId", handlerGetChirpById);
app.post("/api/chirps", handlerCreateChirp);
app.delete("/api/chirps/:chirpId", handlerDeleteChirp);
app.get("/admin/metrics", handlerMetrics);
app.post("/admin/reset", handlerReset);
app.post("/api/polka/webhooks", handlerPolkaWebhook);

app.use("/app", middlewareMetricsInc, express.static("./src/app"));

function middlewareErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    console.log(err);
    res.status(500).json({ error: "Something went wrong on our end" });
  }
}

app.use(middlewareErrorHandler);

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
