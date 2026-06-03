/**
 * FR-18, FR-19: Prerequisite Management
 */
import { useEffect, useMemo, useState } from 'react';
import {
    ActionIcon, Alert, Box, Button, Container, Group, Modal, Paper, Select,
    Skeleton, Stack, Table, Text, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
    IconAlertCircle, IconLink, IconPlus, IconSearch, IconTrash,
} from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';
import { ImportCsvButton } from '../lib/ImportCsvButton';
import { DeleteAllButton } from '../lib/DeleteAllButton';

interface Course { id: string; code: string; title: string; }
interface Prerequisite { id: string; course_id: string; prerequisite_course_id: string; }

export function Prerequisites() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [prerequisites, setPrerequisites] = useState<Prerequisite[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newPrereq, setNewPrereq] = useState({ course_id: '', prerequisite_course_id: '' });
    const [modal, { open, close }] = useDisclosure(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 200);

    useEffect(() => { void fetchAll(); }, []);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            const [cRes, pRes] = await Promise.all([
                apiClient.get<Course[]>('/catalog/courses'),
                apiClient.get<Prerequisite[]>('/scheduling/prerequisites'),
            ]);
            setCourses(cRes.data);
            setPrerequisites(pRes.data);
        } catch (e) {
            toast.error(errMsg(e, 'Could not load prerequisites.'));
        } finally { setIsLoading(false); }
    };

    const handleAdd = async () => {
        if (!newPrereq.course_id || !newPrereq.prerequisite_course_id) {
            toast.error('Pick both a course and its prerequisite.');
            return;
        }
        if (newPrereq.course_id === newPrereq.prerequisite_course_id) {
            toast.error('A course cannot be a prerequisite of itself.');
            return;
        }
        setSaving(true);
        try {
            await apiClient.post('/scheduling/prerequisites', newPrereq);
            toast.success('Prerequisite linked.');
            setNewPrereq({ course_id: '', prerequisite_course_id: '' });
            close();
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not add prerequisite.'));
        } finally { setSaving(false); }
    };

    const handleDelete = async (id: string, label: string) => {
        const ok = await confirm({
            title: 'Remove prerequisite link?',
            danger: true,
            confirmLabel: 'Remove',
            body: <Text size="sm">{label}</Text>,
        });
        if (!ok) return;
        try {
            await apiClient.delete(`/scheduling/prerequisites/${id}`);
            toast.success('Prerequisite removed.');
            void fetchAll();
        } catch (e) {
            toast.error(errMsg(e, 'Could not remove prerequisite.'));
        }
    };

    const codeById = useMemo(() => {
        const m: Record<string, string> = {};
        courses.forEach((c) => { m[c.id] = c.code; });
        return m;
    }, [courses]);
    const titleById = useMemo(() => {
        const m: Record<string, string> = {};
        courses.forEach((c) => { m[c.id] = c.title; });
        return m;
    }, [courses]);

    const filtered = useMemo(() => {
        const q = debouncedSearch.toLowerCase().trim();
        if (!q) return prerequisites;
        return prerequisites.filter((p) => {
            const a = codeById[p.course_id] ?? '';
            const b = codeById[p.prerequisite_course_id] ?? '';
            const ta = titleById[p.course_id] ?? '';
            const tb = titleById[p.prerequisite_course_id] ?? '';
            return (a + ' ' + b + ' ' + ta + ' ' + tb).toLowerCase().includes(q);
        });
    }, [prerequisites, codeById, titleById, debouncedSearch]);

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group justify="space-between" align="center" wrap="wrap">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconLink size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Curriculum</Text>
                                    <Title order={2}>Prerequisites</Title>
                                    <Text size="xs" c="dimmed">Each link enforces FR-18 / FR-19 in the scheduler.</Text>
                                </Box>
                            </Group>
                            <Group gap="sm">
                                <ImportCsvButton entity="prerequisites" onImported={fetchAll} />
                                <DeleteAllButton scope="prerequisites" label="Delete all prerequisites" onDone={fetchAll} />
                                <Button leftSection={<IconPlus size={16} />} onClick={open} variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} radius="lg" disabled={courses.length < 2}>
                                    Add Prerequisite
                                </Button>
                            </Group>
                        </Group>
                        {courses.length < 2 && (
                            <Alert color="orange" icon={<IconAlertCircle size={16}/>} mt="sm" radius="md">
                                You need at least two courses before you can link a prerequisite.
                            </Alert>
                        )}
                    </Paper>

                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                        <Group mb="md">
                            <TextInput
                                placeholder="Search course code or title..."
                                value={search}
                                onChange={(e) => setSearch(e.currentTarget.value)}
                                leftSection={<IconSearch size={14} />}
                                radius="lg"
                                style={{ flex: 1, maxWidth: 360 }}
                            />
                        </Group>
                        {isLoading ? (
                            <Stack gap="sm">{[1, 2, 3].map((i) => <Skeleton key={i} height={44} radius="md" />)}</Stack>
                        ) : filtered.length === 0 ? (
                            <Text c="dimmed" ta="center" py="xl">
                                {debouncedSearch ? 'No prerequisites match your search.' : 'No prerequisites yet.'}
                            </Text>
                        ) : (
                            <Table striped highlightOnHover verticalSpacing="sm">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Course</Table.Th>
                                        <Table.Th>Requires</Table.Th>
                                        <Table.Th style={{ width: 50 }}></Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {filtered.map((p) => {
                                        const cTitle = titleById[p.course_id] ?? '';
                                        const pTitle = titleById[p.prerequisite_course_id] ?? '';
                                        return (
                                            <Table.Tr key={p.id}>
                                                <Table.Td>
                                                    <Text fw={600}>{codeById[p.course_id] ?? '?'}</Text>
                                                    <Text size="xs" c="dimmed">{cTitle}</Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text fw={600}>{codeById[p.prerequisite_course_id] ?? '?'}</Text>
                                                    <Text size="xs" c="dimmed">{pTitle}</Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <ActionIcon color="red" variant="subtle" size="sm"
                                                        onClick={() => handleDelete(p.id,
                                                            `${codeById[p.course_id] ?? '?'} requires ${codeById[p.prerequisite_course_id] ?? '?'}`)}>
                                                        <IconTrash size={15} />
                                                    </ActionIcon>
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

            <Modal opened={modal} onClose={close} title="Add Prerequisite" radius="xl" centered>
                <Stack gap="md">
                    <Select label="Course" required radius="lg" searchable
                        value={newPrereq.course_id}
                        onChange={(v) => setNewPrereq({ ...newPrereq, course_id: v ?? '' })}
                        data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.title}` }))} />
                    <Select label="Requires (prerequisite)" required radius="lg" searchable
                        value={newPrereq.prerequisite_course_id}
                        onChange={(v) => setNewPrereq({ ...newPrereq, prerequisite_course_id: v ?? '' })}
                        data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.title}` }))} />
                    <Group justify="flex-end">
                        <Button variant="subtle" color="gray" onClick={close} radius="lg">Cancel</Button>
                        <Button onClick={handleAdd} loading={saving} radius="lg"
                            variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                            Link
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
