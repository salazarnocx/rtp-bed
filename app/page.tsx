import { getGamesWithCurrentRtp } from "../lib/rtpService";
import HomeClient from "../components/HomeClient";

export const revalidate = 900;

export default async function HomePage() {
  const games = await getGamesWithCurrentRtp();

  return <HomeClient games={games} />;
}
