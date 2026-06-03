import { Alert, Button, Paper, Stack, Text, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

interface TemporarilyUnavailableProps {
    featureName: string;
}

export function TemporarilyUnavailable({ featureName }: TemporarilyUnavailableProps) {
    const navigate = useNavigate();

    return (
        <Paper p="xl" radius="xl" withBorder maw={640}>
            <Stack gap="md">
                <Title order={2}>{featureName} is unavailable in this GitHub build</Title>
                <Text c="dimmed">
                    This section is intentionally turned off in the shared GitHub version for now.
                    The rest of the FCESS workspace remains available.
                </Text>
                <Alert
                    icon={<IconLock size={16} />}
                    title="Temporarily disabled"
                    color="yellow"
                    variant="light"
                >
                    Departments and Rooms are kept out of this version until you are ready to turn them back on.
                </Alert>
                <Button variant="light" w="fit-content" onClick={() => navigate('/')}>
                    Back to dashboard
                </Button>
            </Stack>
        </Paper>
    );
}
