import { useEffect, useState } from 'react';
import {
    ActionIcon, Badge, Box, Button, Container, Group, Modal, NumberInput,
    Paper, Select, Skeleton, Stack, Table, Text, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconPlus, IconSearch, IconTrash, IconUser } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';
import { ImportCsvButton } from '../lib/ImportCsvButton';
import { EditRowButton } from '../lib/EditRowButton';
import { DeleteAllButton } from '../lib/DeleteAllButton';
import { usePagedFilter } from '../lib/usePagedFilter';
import { PagedFooter } from '../lib/PagedFooter';

interface Faculty {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    rank: string;
    department_id: string;
    max_load_hours: number;
}
interface Department { id: string; code: string; name: string; }

const RANKS = [
    { value: 'PROFESSOR', label: 'Professor' },
    { value: 'LECTURER', label: 'Lecturer' },
    { value: 'ASSISTANT', label: 'Assistant' },
];

export function Faculty() {
    const [faculty, setFaculty] = useState<Faculty[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [opened, { open, close }] = useDisclosure(false);
    const [saving, setSaving] = useState(false);

    const [search, setSearch] = useState('');
    const [deptFilter, setDeptFilter] = useState<string | null>(null);
    const [debouncedSearch] = useDebouncedValue(search, 200);
    const paged = usePagedFilter<any>(faculty, {
        searchFields: ['first_name', 'last_name', 'email'],
        defaultPageSize: 25,
    });

    const blankForm = {
        first_name: '', last_name: '', email: '',
        rank: 'LECTURER', department_id: '',
        max_load_hours: 16,
    };
    const [form, setForm] = useState(blankForm);

    useEffect(() => {
        void fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch, deptFilter]);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            const params: Record<string, string> = {};
            if (debouncedSearch) params.q = debouncedSearch;
            if (deptFilter) params.department_id = deptFilter;
            const [fRes, dRes] = await Promise.all([
                apiClient.get<Faculty[]>('/catalog/faculty', { params }),
                apiClient.get<Department[]>('/catalog/departments'),
            ]);
            setFaculty(fRes.data);
            setDepartments(dRes.data);
        } catch (e) {
            toast.error(errMsg(e, 'Could not load lecturers.'));
        } finally {
            setIsLoading(false);
        }
    };

    const openAdd = () => {
        setForm({ ...blankForm, department_id: departments[0]?.id ?? '' });
        open();
    };

    const handleAdd = async () => {
        if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim() || !form.department_id) {
            toast.error('Name, email and department are required.');
            return;
        }
        setSaving(true);
        try {
            await apiClient.post('/catalog/faculty', form);
            toast.success(`${form.first_name} ${form.last_name} added.`);
            close();
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not create lecturer.'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        const ok = await confirm({
            title: `Remove ${name}?`,
            danger: true,
            confirmLabel: 'Remove lecturer',
            body: <Text size="sm">Their course assignments and sessions will be removed too.</Text>,
        });
        if (!ok) return;
        try {
            await apiClient.delete(`/catalog/faculty/${id}`);
            toast.success(`Removed ${name}.`);
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not remove lecturer.'));
        }
    };

    const deptCode = (id: string) => departments.find((d) => d.id === id)?.code ?? '?';

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconUser size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Catalog</Text>
                                    <Title order={2}>Lecturers</Title>
                                    <Text size="xs" c="dimmed">Each lecturer belongs to one department; course assignments live on the Assignments tab.</Text>
                                </Box>
                            </Group>
                            <Group gap="sm">
                                <ImportCsvButton entity="faculty" onImported={fetchAll} />
                                <DeleteAllButton scope="faculty" label="Delete all lecturers" onDone={fetchAll} />
                                <Button leftSection={<IconPlus size={16} />} onClick={openAdd} variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} radius="lg">
                                    Add Lecturer
                                </Button>
                            </Group>
                        </Group>
                    </Paper>

                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                        <Group mb="md" wrap="wrap">
                            <TextInput
                                placeholder="Search name or email..."
                                value={search}
                                onChange={(e) => setSearch(e.currentTarget.value)}
                                leftSection={<IconSearch size={14} />}
                                radius="lg"
                                style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                            />
                            <Select
                                placeholder="All departments"
                                value={deptFilter}
                                onChange={setDeptFilter}
                                data={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
                                clearable
                                radius="lg"
                                style={{ minWidth: 220 }}
                            />
                        </Group>

                        {isLoading ? (
                            <Stack gap="sm">{[1, 2, 3].map((i) => <Skeleton key={i} height={44} radius="md" />)}</Stack>
                        ) : faculty.length === 0 ? (
                            <Text c="dimmed" ta="center" py="xl">No lecturers match your filters.</Text>
                        ) : (
                            <Table striped highlightOnHover verticalSpacing="sm">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Name</Table.Th>
                                        <Table.Th>Email</Table.Th>
                                        <Table.Th>Department</Table.Th>
                                        <Table.Th>Rank</Table.Th>
                                        <Table.Th>Max load</Table.Th>
                                        <Table.Th style={{ width: 50 }}></Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {paged.visible.map((f: Faculty) => (
                                        <Table.Tr key={f.id}>
                                            <Table.Td><Text fw={500}>{f.last_name}, {f.first_name}</Text></Table.Td>
                                            <Table.Td>{f.email}</Table.Td>
                                            <Table.Td>{deptCode(f.department_id)}</Table.Td>
                                            <Table.Td><Badge variant="light" radius="sm">{f.rank}</Badge></Table.Td>
                                            <Table.Td>{f.max_load_hours}</Table.Td>
                                            <Table.Td>
                                                <Group gap={4}>
                                                <EditRowButton
                                                    title={`Edit ${f.first_name} ${f.last_name}`}
                                                    endpoint={`/catalog/faculty/${f.id}`}
                                                    fields={[
                                                        { name: 'first_name', label: 'First name', value: f.first_name },
                                                        { name: 'last_name',  label: 'Last name',  value: f.last_name },
                                                        { name: 'email',      label: 'Email',      value: f.email },
                                                        { kind: 'select', name: 'department_id', label: 'Department', value: f.department_id,
                                                            options: departments.map(d => ({ value: d.id, label: `${d.code} — ${d.name}` })), searchable: true },
                                                        { kind: 'select', name: 'rank', label: 'Rank', value: f.rank,
                                                            options: [
                                                                { value: 'PROFESSOR', label: 'Professor' },
                                                                { value: 'LECTURER',  label: 'Lecturer' },
                                                                { value: 'ASSISTANT', label: 'Assistant' },
                                                            ] },
                                                        { kind: 'number', name: 'max_load_hours', label: 'Max load hours', value: f.max_load_hours, min: 0, step: 0.5 },
                                                    ]}
                                                    onSaved={fetchAll}
                                                />
                                                <ActionIcon color="red" variant="subtle" size="sm" onClick={() => handleDelete(f.id, `${f.first_name} ${f.last_name}`)}>
                                                    <IconTrash size={15} />
                                                </ActionIcon>
                                            </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        )}
                        <PagedFooter
                            page={paged.page}
                            totalPages={paged.totalPages}
                            pageSize={paged.pageSize}
                            totalFiltered={paged.totalFiltered}
                            totalRaw={paged.totalRaw}
                            onPageChange={paged.setPage}
                            onPageSizeChange={paged.setPageSize}
                        />
                    </Paper>
                </Stack>
            </Container>

            <Modal opened={opened} onClose={close} title="Add Lecturer" radius="xl" centered size="lg">
                <Stack gap="md">
                    <Group grow>
                        <TextInput label="First name" required radius="lg"
                            value={form.first_name}
                            onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                        <TextInput label="Last name" required radius="lg"
                            value={form.last_name}
                            onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
                    </Group>
                    <TextInput label="Email" type="email" required radius="lg"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    <Group grow>
                        <Select label="Department" required radius="lg"
                            value={form.department_id}
                            onChange={(v) => setForm({ ...form, department_id: v ?? '' })}
                            data={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))} />
                        <Select label="Rank" radius="lg"
                            value={form.rank}
                            onChange={(v) => setForm({ ...form, rank: v ?? 'LECTURER' })}
                            data={RANKS} />
                        <NumberInput label="Max load (h)" min={0} step={0.5} radius="lg"
                            value={form.max_load_hours}
                            onChange={(v) => setForm({ ...form, max_load_hours: Number(v) || 0 })} />
                    </Group>
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={close} radius="lg">Cancel</Button>
                        <Button onClick={handleAdd} loading={saving} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}
                            disabled={!form.first_name || !form.last_name || !form.email || !form.department_id}>
                            Save
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
