# Chirpy

A Twitter-like API server built with Express, TypeScript, Drizzle ORM, and PostgreSQL. Based on the Boot.dev course [Learn HTTP Servers in TypeScript](https://www.boot.dev/courses/learn-http-servers-typescript).

## Prerequisites

- Node.js 22.14.0 (see `.nvmrc`)
- PostgreSQL running locally

## Setup

```bash
# Install dependencies
npm install

# Create a PostgreSQL database
createdb chirpy

# Create a .env file in the project root
cp .env.example .env
# Then fill in your values (see below)
```

### Environment Variables

Create a `.env` file with:

```
DB_URL="postgres://<user>:<password>@localhost:5432/chirpy?sslmode=disable"
PLATFORM="dev"
JWT_SECRET="<generate with: openssl rand -base64 64>"
POLKA_KEY="<your polka api key>"
```

## Running

```bash
# Development (compiles TypeScript and starts the server)
npm run dev

# Or build and start separately
npm run build
npm start
```

The server runs at `http://localhost:8080`.

## Database Migrations

Migrations run automatically on server start. You can also run them manually:

```bash
# Generate a new migration after schema changes
npm run generate

# Apply pending migrations
npm run migrate
```

## Testing

```bash
npm test
```

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/healthz` | Readiness check |
| POST | `/api/users` | Create a user |
| POST | `/api/login` | Login, returns access + refresh tokens |
| POST | `/api/refresh` | Get a new access token |
| POST | `/api/revoke` | Revoke a refresh token |
| GET | `/api/chirps` | List chirps (supports `authorId` and `sort` query params) |
| GET | `/api/chirps/:chirpId` | Get a single chirp |

### Authenticated (Bearer token required)

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/users` | Update your email and password |
| POST | `/api/chirps` | Create a chirp |
| DELETE | `/api/chirps/:chirpId` | Delete your own chirp |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/metrics` | View hit counter |
| POST | `/admin/reset` | Reset database (dev only) |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/polka/webhooks` | Polka payment webhook (ApiKey auth) |

## Static Files

Static files are served from `/app` (mapped to `src/app/`).
