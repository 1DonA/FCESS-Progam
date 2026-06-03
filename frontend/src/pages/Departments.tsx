import { useEffect, useState } from 'react';
import {
    ActionIcon, Badge, Box, Button, Container, Group, Modal, Paper, Skeleton,
    Stack, Table, Text, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
    IconBuilding, IconBuildingSkyscraper, IconPlus, IconSearch, IconTrash, IconHome,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { roomRequestsApi, type RoomRequest } from '../api/roomRequests';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';
import { EditRowButton } from '../lib/EditRowButton';
import { ImportCsvButton } from '../lib/ImportCsvButton';
import { DeleteAllButton } from '../lib/DeleteAllButton';

interface Department {
    id: string;
    code: string;
    name: string;
    parent_id?: string | null;
}

export function Departments() {
    const navigate = useNavigate();
    const [departments, setDepartments] = useState<Department[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [opened, { open, close }] = useDisclosure(false);
    const [newDept, setNewDept] = useState({ code: '', name: '' });
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 200);

    const [buildingsByDept, setBuildingsByDept] = useState<Record<string, { code: string; name: string }[]>>({});
    const fetchBuildings = async () => {
        try {
            const r = await apiClient.get<{ id: string; code: string; name: string; department_id?: string | null }[]>('/catalog/buildings');
            const map: Record<string, { code: string; name: string }[]> = {};
            r.data.forEach((b) => {
                if (!b.department_id) return;
                map[b.department_id] = map[b.department_id] || [];
                map[b.department_id].push({ code: b.code, name: b.name });
            });
            setBuildingsByDept(map);
        } catch { /* silent */ }
    };
    useEffect(() => { void fetchBuildings(); }, []);

    const [requestCounts, setRequestCounts] = useState<Record<string, { incoming: number; outgoing: number }>>({});
    const fetchRequestCounts = async () => {
        try {
            const [inc, out] = await Promise.all([
                roomRequestsApi.incoming('PENDING').catch(() => [] as RoomRequest[]),
                roomRequestsApi.outgoing('PENDING').catch(() => [] as RoomRequest[]),
            ]);
            const map: Record<string, { incoming: number; outgoing: number }> = {};
            inc.forEach((r) => {
                const k = r.owner_department_id;
                map[k] = map[k] || { incoming: 0, outgoing: 0 };
                map[k].incoming += 1;
            });
            out.forEach((r) => {
                const k = r.requester_department_id;
                map[k] = map[k] || { incoming: 0, outgoing: 0 };
                map[k].outgoing += 1;
            });
            setRequestCounts(map);
        } catch { /* silent */ }
    };
    const totalPending = Object.values(requestCounts).reduce((s, x) => s + x.incoming + x.outgoing, 0);

    useEffect(() => {
        void fetchRequestCounts();
        const id = setInterval(fetchRequestCounts, 30_000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        void fetchDepartments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const fetchDepartments = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<Department[]>('/catalog/departments', {
                params: debouncedSearch ? { q: debouncedSearch } : undefined,
            });
            setDepartments(res.data);
        } catch (e) {
            toast.error(errMsg(e, 'Could not load departments.'));
        } finally {
            setIsLoading(false);
        }
    };

    const deriveCode = (name: string): string => {
        const stop = new Set(['FACULTY', 'OF', 'THE', 'AND', 'SCHOOL', 'FOR', 'A']);
        const tokens = name.toUpperCase().replace(/[^A-Z\s]/g, '').split(/\s+/).filter(Boolean);
        const meaningful = tokens.filter((t) => !stop.has(t));
        const first = meaningful[0] || tokens[0] || 'NEW';
        let out = first.slice(0, 4);
        if (out.length < 4 && meaningful[1]) out += meaningful[1].slice(0, 4 - out.length);
        return out.padEnd(4, 'X');
    };

    const handleAdd = async () => {
        if (!newDept.name.trim()) {
            toast.error('Name is required.');
            return;
        }
        const finalCode = (newDept.code.trim() || deriveCode(newDept.name)).toUpperCase();
        setSaving(true);
        try {
            await apiClient.post('/catalog/departments', {
                code: finalCode,
                name: newDept.name.trim(),
            });
            toast.success('Faculty "' + newDept.name.trim() + '" created (code: ' + finalCode + ').');
            setNewDept({ code: '', name: '' });
            close();
            void fetchDepartments();
        } catch (e) {
            toast.error(errMsg(e, 'Could not create faculty.'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, code: string) => {
        const ok = await confirm({
            title: 'Delete faculty ' + code + '?',
            danger: true,
            confirmLabel: 'Delete faculty',
            body: (
                <Stack gap={4}>
                    <Text size="sm">This will cascade and delete all courses, lecturers, sessions, and assignments in {code}.</Text>
                </Stack>
            ),
        });
        if (!ok) return;
        try {
            await apiClient.delete('/catalog/departments/' + id);
            toast.success('Faculty ' + code + ' deleted.');
            void fetchDepartments();
        } catch (e) {
            toast.error(errMsg(e, 'Could not delete faculty.'));
        }
    };

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconBuildingSkyscraper size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Catalog</Text>
                                    <Title order={2}>Faculties</Title>
                                    <Text size="xs" c="dimmed">All academic faculties &amp; schools (e.g. Faculty of Engineering, Faculty of Architecture).</Text>
                                </Box>
                            </Group>
                            <Group gap="sm">
                                <Button
                                    leftSection={<IconHome size={16} />}
                                    variant="light"
                                    color={totalPending > 0 ? 'red' : 'gray'}
                                    radius="lg"
                                    rightSection={totalPending > 0 ? (<Badge color="red" variant="filled" size="xs" circle>{totalPending}</Badge>) : null}
                                    onClick={() => navigate('/room-requests')}>
                                    Room Requests
                                </Button>
                                <ImportCsvButton entity="departments" label="Import faculties CSV" onImported={fetchDepartments} />
                                <DeleteAllButton scope="departments" label="Delete all faculties" cascade onDone={fetchDepartments} />
                                <Button leftSection={<IconPlus size={16} />} onClick={open} variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} radius="lg">
                                    Add Faculty
                                </Button>
                            </Group>
                        </Group>
                    </Paper>

                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                        <Group mb="md">
                            <TextInput
                                placeholder="Search code or name..."
                                value={search}
                                onChange={(e) => setSearch(e.currentTarget.value)}
                                leftSection={<IconSearch size={14} />}
                                radius="lg"
                                style={{ flex: 1, maxWidth: 360 }}
                            />
                        </Group>

                        {isLoading ? (
                            <Stack gap="sm">{[1, 2, 3].map((i) => <Skeleton key={i} height={44} radius="md" />)}</Stack>
                        ) : departments.length === 0 ? (
                            <Stack align="center" py="xl" gap="sm">
                                <ThemeIcon size={56} radius="xl" variant="light" color="gray"><IconBuilding size={28} /></ThemeIcon>
                                <Text c="dimmed" fw={500}>
                                    {debouncedSearch ? 'No faculties match your search.' : 'No faculties yet'}
                                </Text>
                                {!debouncedSearch && (
                                    <Button size="xs" variant="light" onClick={open} leftSection={<IconPlus size={14} />}>
                                        Add your first faculty
                                    </Button>
                                )}
                            </Stack>
                        ) : (
                            <Table striped highlightOnHover verticalSpacing="sm">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Code</Table.Th>
                                        <Table.Th>Faculty</Table.Th>
                                        <Table.Th>Departments</Table.Th>
                                        <Table.Th>Buildings</Table.Th>
                                        <Table.Th>Room Requests</Table.Th>
                                        <Table.Th style={{ width: 60 }}></Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {departments.filter((d) => !d.parent_id).map((dept) => {
                                        const counts = requestCounts[dept.id] || { incoming: 0, outgoing: 0 };
                                        const children = departments.filter((d) => d.parent_id === dept.id);
                                        return (
                                            <Table.Tr key={dept.id}>
                                                <Table.Td>
                                                    <Badge variant="light" color="brand" size="md" radius="sm" fw={700}>{dept.code}</Badge>
                                                </Table.Td>
                                                <Table.Td><Text fw={500}>{dept.name}</Text></Table.Td>
                                                <Table.Td>
                                                    {children.length === 0
                                                        ? <Text c="dimmed" size="xs">— top-level only —</Text>
                                                        : (
                                                            <Group gap={4} wrap="wrap">
                                                                {children.map((ch) => (
                                                                    <Badge key={ch.id} size="sm" variant="light" color="teal" title={ch.name} radius="sm">
                                                                        {ch.code}
                                                                    </Badge>
                                                                ))}
                                                                <Text size="xs" c="dimmed">· {children.length} dept{children.length === 1 ? '' : 's'}</Text>
                                                            </Group>
                                                        )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {(buildingsByDept[dept.id] || []).length === 0
                                                        ? <Text c="dimmed" size="xs">— none —</Text>
                                                        : (
                                                            <Group gap={4} wrap="wrap">
                                                                {(buildingsByDept[dept.id] || []).map((b) => (
                                                                    <Badge key={b.code} variant="light" color="indigo"
                                                                        title={b.name} radius="sm" size="sm"
                                                                        style={{ cursor: 'pointer' }}
                                                                        onClick={() => navigate('/rooms')}>
                                                                        {b.code}
                                                                    </Badge>
                                                                ))}
                                                            </Group>
                                                        )}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group gap={4} wrap="nowrap">
                                                        <Badge size="sm" variant="light" color={counts.incoming > 0 ? 'red' : 'gray'} style={{ cursor: 'pointer' }} onClick={() => navigate('/room-requests')}>
                                                            {counts.incoming} incoming
                                                        </Badge>
                                                        <Badge size="sm" variant="light" color={counts.outgoing > 0 ? 'orange' : 'gray'} style={{ cursor: 'pointer' }} onClick={() => navigate('/room-requests')}>
                                                            {counts.outgoing} outgoing
                                                        </Badge>
                                                    </Group>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group gap={4}>
                                                        <EditRowButton
                                                            title={'Edit faculty ' + dept.code}
                                                            endpoint={'/catalog/departments/' + dept.id}
                                                            fields={[
                                                                { name: 'code', label: 'Code', value: dept.code, required: true },
                                                                { name: 'name', label: 'Name', value: dept.name, required: true },
                                                            ]}
                                                            onSaved={fetchDepartments}
                                                        />
                                                        <ActionIcon color="red" variant="subtle" size="sm" onClick={() => handleDelete(dept.id, dept.code)}>
                                                            <IconTrash size={15} />
                                                        </ActionIcon>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                        )}
                    </Paper>
                </Stack>
            </Container>

            <Modal opened={opened} onClose={close} title="Add Faculty" radius="xl" centered>
                <Stack gap="md">
                    <TextInput
                        label="Faculty name"
                        placeholder="e.g. Faculty of Engineering"
                        value={newDept.name}
                        onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                        required radius="lg"
                        description={newDept.name
                            ? 'A short code will be auto-generated: ' + (newDept.code.trim() || deriveCode(newDept.name)).toUpperCase()
                            : 'Enter the full faculty name; the short tag is created automatically.'}
                    />
                    <TextInput
                        label="Override code (optional)"
                        placeholder="Leave blank to auto-generate"
                        value={newDept.code}
                        onChange={(e) => setNewDept({ ...newDept, code: e.target.value })}
                        radius="lg"
                        description="Only set this if you want a specific short tag (used for CSV imports & API)."
                    />
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={close} radius="lg">Cancel</Button>
                        <Button onClick={handleAdd} loading={saving} radius="lg" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} disabled={!newDept.name}>Save</Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
