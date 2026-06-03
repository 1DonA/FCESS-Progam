/**
 * Self-service signup.
 *
 * Anyone can create a FACULTY or CHAIR account here (ADMIN is reserved and
 * must be created via the seed script). If the email matches an existing
 * Faculty row, the backend auto-links the account so the lecturer's
 * "My Schedule" view works on first login.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    Alert, Anchor, Badge, Box, Button, Container, Group, Paper,
    PasswordInput, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { IconAlertCircle, IconCalendarTime, IconUserPlus } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { authApi } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { toast } from '../lib/feedback';

interface Department { id: string; code: string; name: string; }

export function Signup() {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [form, setForm] = useState({
        full_name: '',
        email: '',
        password: '',
        role: 'FACULTY',
        department_id: '',
        faculty_email: '',
    });

    useEffect(() => {
        // Use the PUBLIC endpoint — Signup is reached before the user has a
        // token, so /catalog/departments would 401. /catalog/public/departments
        // is intentionally unauthenticated.
        apiClient.get<Department[]>('/catalog/public/departments')
            .then((r) => setDepartments(r.data))
            .catch(() => setDepartments([]));
    }, []);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await authApi.register({
                email: form.email,
                password: form.password,
                full_name: form.full_name,
                role: form.role,
                department_id: form.department_id || undefined,
                faculty_email: form.faculty_email || undefined,
            } as any);
            await login({ email: form.email, password: form.password });
            const deptName = departments.find((d) => d.id === form.department_id)?.name;
            toast.success(deptName ? `Account created for ${deptName}.` : 'Account created. Welcome!');
            navigate('/');
        } catch (err: any) {
            setError(err?.response?.data?.detail || 'Sign-up failed.');
        } finally {
            setBusy(false);
        }
    };

    const pickedDept = departments.find((d) => d.id === form.department_id);

    return (
        <Box mih="100vh" py={{ base: 32, md: 48 }} style={{ display: 'flex', alignItems: 'center' }}>
            <Container size="md" w="100%">
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing={{ base: 'xl', md: 48 }}>
                    <Stack justify="center" gap="xl">
                        <Group gap="sm" wrap="nowrap">
                            <ThemeIcon size={48} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                <IconCalendarTime size={24} />
                            </ThemeIcon>
                            <Box>
                                <Text fw={800} size="lg">FCESS</Text>
                                <Text size="sm" c="dimmed">Faculty Course &amp; Scheduling System</Text>
                            </Box>
                        </Group>
                        <Stack gap="sm">
                            <Title order={2}>Create your account</Title>
                            <Text c="dimmed">
                                Lecturers and department chairs can self-register. If your email is already
                                on the faculty roster you'll be linked automatically so your personal
                                schedule shows up on first login.
                            </Text>
                            <Badge color="teal" variant="light" w="fit-content">
                                Admin accounts are seeded by the system — they can't be created here.
                            </Badge>
                        </Stack>
                    </Stack>

                    <Paper p={{ base: 'xl', sm: 36 }} radius="xl" shadow="lg"
                        style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(18px)', borderColor: 'rgba(148,163,184,0.2)' }}>
                        <Stack gap="lg">
                            <Box>
                                <Title order={3}>Sign up</Title>
                                <Text size="sm" c="dimmed" mt={4}>
                                    Already have an account? <Anchor component={Link} to="/login">Sign in</Anchor>.
                                </Text>
                            </Box>
                            <form onSubmit={onSubmit}>
                                <Stack gap="md">
                                    {error && (
                                        <Alert icon={<IconAlertCircle size={16} />} color="red" radius="md">
                                            {error}
                                        </Alert>
                                    )}
                                    <TextInput
                                        label="Full name"
                                        placeholder="Dr. Jane Doe"
                                        value={form.full_name}
                                        onChange={(e) => setForm({ ...form, full_name: e.currentTarget.value })}
                                        required
                                    />
                                    <TextInput
                                        label="Email"
                                        placeholder="jane.doe@uni.edu"
                                        type="email"
                                        value={form.email}
                                        onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
                                        required
                                    />
                                    <PasswordInput
                                        label="Password"
                                        placeholder="At least 8 characters"
                                        value={form.password}
                                        onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
                                        required
                                        minLength={8}
                                    />
                                    <Select
                                        label="Role"
                                        data={[
                                            { value: 'FACULTY', label: 'Lecturer — view my own schedule' },
                                            { value: 'CHAIR',   label: 'Department Chair — manage my department' },
                                        ]}
                                        value={form.role}
                                        onChange={(v) => setForm({ ...form, role: v || 'FACULTY' })}
                                    />
                                    <Select
                                        label="Faculty / Department"
                                        description="Pick the faculty this account belongs to. Chairs only see this faculty's data."
                                        placeholder="Faculty of Engineering, Faculty of Architecture, …"
                                        data={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
                                        value={form.department_id}
                                        onChange={(v) => setForm({ ...form, department_id: v || '' })}
                                        searchable
                                        required={form.role === 'CHAIR'}
                                        nothingFoundMessage="No departments yet — ask the admin to import the departments CSV first."
                                    />
                                    {pickedDept && (
                                        <Badge color="teal" variant="light" w="fit-content">
                                            This account will own: {pickedDept.code} — {pickedDept.name}
                                        </Badge>
                                    )}
                                    <TextInput
                                        label="Faculty roster email (optional)"
                                        description="If your email is already on the Lecturers list with a different address, enter it here to link your account."
                                        placeholder="Leave blank to use login email"
                                        value={form.faculty_email}
                                        onChange={(e) => setForm({ ...form, faculty_email: e.currentTarget.value })}
                                    />
                                    <Button
                                        type="submit"
                                        loading={busy}
                                        variant="gradient"
                                        gradient={{ from: 'brand.6', to: 'sky.5' }}
                                        leftSection={<IconUserPlus size={16} />}
                                        fullWidth
                                    >
                                        Create account
                                    </Button>
                                </Stack>
                            </form>
                        </Stack>
                    </Paper>
                </SimpleGrid>
            </Container>
        </Box>
    );
}
