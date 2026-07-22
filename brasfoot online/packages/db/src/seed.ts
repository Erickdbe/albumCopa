import "dotenv/config";
import { importCompetition } from "@brfut/football-data-adapter";
import { prisma } from "./client.js";
import { fillMissingSquads, generateFallbackSquad } from "./fallbackPlayers.js";
import { createLeagueWithClubs, type LeagueSetupClub } from "./leagueSetup.js";

// Free-tier-friendly default: a small competition. Override with
// FOOTBALL_DATA_COMPETITION if you have access to a different one.
const COMPETITION_CODE = process.env.FOOTBALL_DATA_COMPETITION ?? "PD";

interface SeedClub extends LeagueSetupClub {
  country: string;
}

async function loadClubs(): Promise<SeedClub[]> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (apiKey) {
    console.log(`Fetching squads for competition "${COMPETITION_CODE}" from football-data.org...`);
    const clubs = await importCompetition({ apiKey }, COMPETITION_CODE);
    return fillMissingSquads(clubs);
  }

  console.log("FOOTBALL_DATA_API_KEY not set — generating a fictional squad instead.");
  return [
    {
      name: "FC Exemplo",
      shortName: "EXE",
      stadiumName: "Estadio Exemplo",
      country: "Brazil",
      reputation: 60,
      players: generateFallbackSquad("home", 60),
    },
    {
      name: "Clube Rival",
      shortName: "RIV",
      stadiumName: "Arena Rival",
      country: "Brazil",
      reputation: 55,
      players: generateFallbackSquad("away", 55),
    },
  ];
}

async function main() {
  const clubs = await loadClubs();

  const { league, clubs: createdClubs } = await createLeagueWithClubs({
    name: "Liga BrFut de Testes",
    country: clubs[0]?.country ?? "Brazil",
    clubs,
    createDemoMatch: true,
  });

  console.log(`Seeded league "${league.name}" with ${createdClubs.length} clubs.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
