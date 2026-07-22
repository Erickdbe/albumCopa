import { useEffect, useState } from "react";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  Card,
  Title,
  Text,
  Table,
  Rating,
  Badge,
  Button,
  NumberInput,
  Select,
  Stack,
  Group,
  Alert,
  Center,
  Loader,
} from "@mantine/core";
import { apiFetch, ApiError } from "../api/client.js";
import { starsForOverall, type Club, type Listing } from "../api/types.js";

const DURATION_OPTIONS = [
  { value: "1", label: "1 hora" },
  { value: "6", label: "6 horas" },
  { value: "24", label: "1 dia" },
  { value: "72", label: "3 dias" },
  { value: "168", label: "7 dias" },
];

interface NewListingForm {
  playerId: string;
  startingPrice: number;
  buyNowPrice: number | "";
  durationHours: string;
}

export function MarketPage() {
  const [club, setClub] = useState<Club | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidAmounts, setBidAmounts] = useState<Record<string, number | "">>({});
  const [bidding, setBiddingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const form = useForm<NewListingForm>({
    initialValues: { playerId: "", startingPrice: 100000, buyNowPrice: "", durationHours: "24" },
  });

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [clubData, listingsData] = await Promise.all([
        apiFetch<Club>("/clubs/mine").catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        apiFetch<{ listings: Listing[] }>("/market/listings"),
      ]);
      setClub(clubData);
      setListings(listingsData.listings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load market");
    } finally {
      setLoading(false);
    }
  }

  async function submitBid(listingId: string) {
    const amount = bidAmounts[listingId];
    if (!amount || amount <= 0) return;
    setBiddingId(listingId);
    try {
      await apiFetch(`/market/listings/${listingId}/bids`, { method: "POST", body: { amount } });
      notifications.show({ color: "green", message: "Lance registrado!" });
      await loadAll();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Falha ao dar lance" });
    } finally {
      setBiddingId(null);
    }
  }

  async function createListing(values: NewListingForm) {
    setCreating(true);
    try {
      await apiFetch("/market/listings", {
        method: "POST",
        body: {
          playerId: values.playerId,
          startingPrice: values.startingPrice,
          buyNowPrice: values.buyNowPrice === "" ? undefined : values.buyNowPrice,
          durationHours: Number(values.durationHours),
        },
      });
      notifications.show({ color: "green", message: "Jogador listado no mercado!" });
      form.reset();
      await loadAll();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Falha ao listar jogador" });
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  return (
    <Stack>
      <Title order={2}>Mercado de transferências</Title>
      {error && (
        <Alert color="red" title="Erro">
          {error}
        </Alert>
      )}

      {club && (
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Title order={4} mb="sm">
            Listar um jogador do {club.name}
          </Title>
          <form onSubmit={form.onSubmit(createListing)}>
            <Group align="flex-end">
              <Select
                label="Jogador"
                placeholder="Escolha um jogador"
                data={(club.players ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.position}, overall ${p.overall})` }))}
                required
                w={280}
                {...form.getInputProps("playerId")}
              />
              <NumberInput label="Preço inicial" min={1} required w={150} {...form.getInputProps("startingPrice")} />
              <NumberInput label="Compra já (opcional)" min={1} w={150} {...form.getInputProps("buyNowPrice")} />
              <Select label="Prazo" data={DURATION_OPTIONS} w={120} {...form.getInputProps("durationHours")} />
              <Button type="submit" loading={creating}>
                Listar
              </Button>
            </Group>
          </form>
        </Card>
      )}

      <Card withBorder shadow="sm" radius="md" p="lg">
        <Title order={4} mb="sm">
          Listagens abertas ({listings.length})
        </Title>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Jogador</Table.Th>
              <Table.Th>Nível</Table.Th>
              <Table.Th>Vendedor</Table.Th>
              <Table.Th>Preço atual</Table.Th>
              <Table.Th>Prazo</Table.Th>
              <Table.Th>Lance</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {listings.map((listing) => {
              const currentPrice = Number(listing.currentBid ?? listing.startingPrice);
              const isOwn = club && listing.sellerClub.id === club.id;
              return (
                <Table.Tr key={listing.id}>
                  <Table.Td>
                    {listing.player.name} <Text span c="dimmed" size="sm">({listing.player.position})</Text>
                  </Table.Td>
                  <Table.Td>
                    <Rating value={starsForOverall(listing.player.overall)} readOnly count={5} size="xs" />
                  </Table.Td>
                  <Table.Td>{listing.sellerClub.name}</Table.Td>
                  <Table.Td>
                    <Badge color="green" variant="light">
                      R$ {currentPrice.toLocaleString("pt-BR")}
                    </Badge>
                    {listing.buyNowPrice && (
                      <Text size="xs" c="dimmed">
                        Compra já: R$ {Number(listing.buyNowPrice).toLocaleString("pt-BR")}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{new Date(listing.endsAt).toLocaleString("pt-BR")}</Text>
                  </Table.Td>
                  <Table.Td>
                    {isOwn ? (
                      <Badge color="gray">Seu jogador</Badge>
                    ) : club ? (
                      <Group gap={4} wrap="nowrap">
                        <NumberInput
                          size="xs"
                          w={110}
                          placeholder={`> ${currentPrice}`}
                          value={bidAmounts[listing.id] ?? ""}
                          onChange={(value) => setBidAmounts((prev) => ({ ...prev, [listing.id]: value as number | "" }))}
                        />
                        <Button size="xs" loading={bidding === listing.id} onClick={() => submitBid(listing.id)}>
                          Dar lance
                        </Button>
                      </Group>
                    ) : (
                      <Text size="xs" c="dimmed">
                        Reivindique um clube pra participar
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
