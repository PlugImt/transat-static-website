import { useTranslation } from "react-i18next";

import type { Route } from "../+types/root";
import { Card, Container, Section, Stack, Text } from "../components";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Account Deletion - Transat" },
    {
      name: "description",
      content:
        "Information about deleting your Transat account from the app settings or by email request.",
    },
  ];
};

export default function AccountDeletion() {
  const { t } = useTranslation();

  return (
    <Section
      title={t("accountDeletion.title")}
      subtitle={t("accountDeletion.subtitle")}
      spacing="xl"
    >
      <Container maxWidth="md">
        <Card>
          <Stack spacing="md">
            <Text>{t("accountDeletion.fromSettings")}</Text>
            <Text>
              {t("accountDeletion.byEmail")}{" "}
              <a
                href="mailto:plugimt@gmail.com"
                className="text-blue-400 underline hover:text-blue-500"
              >
                plugimt@gmail.com
              </a>
              .
            </Text>
          </Stack>
        </Card>
      </Container>
    </Section>
  );
}
