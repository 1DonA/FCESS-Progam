import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    Badge,
    Box,
    Paper,
    TextInput,
    PasswordInput,
    Button,
    Title,
    Container,
    SimpleGrid,
    Stack,
    Text,
    Alert,
    Group,
    ThemeIcon
} from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import {
    IconAlertCircle,
    IconBuildingCommunity,
    IconCalendarTime,
    IconSparkles
} from '@tabler/icons-react';
import { Anchor } from '@mantine/core';

export function Login() {
    const { login, isLoading, error } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await login({ email, password });
            navigate('/');
        } catch {}
    };

    return (
        <Box
            mih="100vh"
            py={{ base: 32, md: 48 }}
            style={{ display: 'flex', alignItems: 'center' }}
        >
            <Container size="lg" w="100%">
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 'xl', md: 56 }}>
                    <Stack justify="center" gap="xl">
                        <Group gap="sm" wrap="nowrap">
                            <ThemeIcon
                                size={48}
                                radius="xl"
                                variant="gradient"
                                gradient={{ from: 'brand.6', to: 'sky.5' }}
                            >
                                <IconCalendarTime size={24} />
                            </ThemeIcon>
                            <Box>
                                <Text fw={800} size="lg">FCESS Admin</Text>
                                <Text size="sm" c="dimmed">Faculty Course Evaluation &amp; Scheduling System</Text>
                            </Box>
                        </Group>

                        <Badge
                            variant="light"
                            color="brand"
                            leftSection={<IconSparkles size={12} />}
                            size="lg"
                            w="fit-content"
                        >
                            Built for calmer academic planning
                        </Badge>

                        <Stack gap="sm">
                            <Title order={1} maw={420}>
                                Clearer scheduling, lighter screens, less friction.
                            </Title>
                            <Text c="dimmed" size="lg" maw={520}>
                                Review workload, manage rooms, and coordinate semester planning from a workspace
                                designed to feel focused instead of heavy.
                            </Text>
                        </Stack>

                        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
                            <Paper
                                p="lg"
                                radius="xl"
                                style={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.72)',
                                    borderColor: 'rgba(148, 163, 184, 0.16)',
                                }}
                            >
                                <Text size="sm" fw={700}>Smart scheduling</Text>
                                <Text size="sm" c="dimmed" mt={4}>
                                    Build balanced timetables with fewer manual collisions.
                                </Text>
                            </Paper>
                            <Paper
                                p="lg"
                                radius="xl"
                                style={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.72)',
                                    borderColor: 'rgba(148, 163, 184, 0.16)',
                                }}
                            >
                                <Group gap={8} wrap="nowrap">
                                    <ThemeIcon size={34} radius="xl" variant="light" color="sky">
                                        <IconBuildingCommunity size={18} />
                                    </ThemeIcon>
                                    <Box>
                                        <Text size="sm" fw={700}>Room and faculty context</Text>
                                        <Text size="sm" c="dimmed" mt={2}>
                                            Keep departments, spaces, and teaching loads aligned.
                                        </Text>
                                    </Box>
                                </Group>
                            </Paper>
                        </SimpleGrid>
                    </Stack>

                    <Paper
                        p={{ base: 'xl', sm: 36 }}
                        radius="xl"
                        shadow="lg"
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.86)',
                            backdropFilter: 'blur(18px)',
                            borderColor: 'rgba(148, 163, 184, 0.2)',
                        }}
                    >
                        <Stack gap="lg">
                            <Box>
                                <Title order={2}>Welcome back</Title>
                                <Text c="dimmed" size="sm" mt={6}>
                                    Sign in to continue to the planning workspace.
                                </Text>
                            </Box>

                            <form onSubmit={handleSubmit}>
                                <Stack gap="md">
                                    {error && (
                                        <Alert icon={<IconAlertCircle size={16} />} title="Authentication failed" color="red">
                                            {error}
                                        </Alert>
                                    )}
                                    <TextInput
                                        label="Email"
                                        placeholder="admin@fcess.com"
                                        required
                                        size="md"
                                        value={email}
                                        onChange={(e) => setEmail(e.currentTarget.value)}
                                    />
                                    <PasswordInput
                                        label="Password"
                                        placeholder="Your password"
                                        required
                                        size="md"
                                        value={password}
                                        onChange={(e) => setPassword(e.currentTarget.value)}
                                    />
                                    <Button
                                        fullWidth
                                        mt="sm"
                                        type="submit"
                                        loading={isLoading}
                                        variant="gradient"
                                        gradient={{ from: 'brand.6', to: 'sky.5' }}
                                    >
                                        Sign in
                                    </Button>
                                </Stack>
                            </form>

                            <Text c="dimmed" size="sm">
                                New lecturer or chair? <Anchor component={Link} to="/signup">Create an account</Anchor>.
                                Admin accounts are seeded by the system.
                            </Text>
                        </Stack>
                    </Paper>
                </SimpleGrid>
            </Container>
        </Box>
    );
}
