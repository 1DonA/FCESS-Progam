import { useState, useEffect } from 'react';
import {
    Container, Title, Button, Text, Paper, Group, Stack, Table,
    Modal, TextInput, Select, NumberInput, ActionIcon, Badge, Box, ThemeIcon,
    Skeleton, Tabs, Alert
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCalendarTime, IconPlus, IconTrash, IconPlayerPlay, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';

interface Semester { id: string; name: string; start_date: string; end_date: string; is_active: boolean; }
interface Course { id: string; code: string; title: string; department_id: string; }
interface Section { id: string; course_id: string; semester_id: string; section_number: string; expected_enrollment: number; course?: Course; }

export function Scheduling() {
    const [semesters, setSemesters] = useState<Semester[]>([]);
    const [sections, setSections] = useState<Section[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [genResult, setGenResult] = useState<any>(null);

    const [semModal, { open: openSem, close: closeSem }] = useDisclosure(false);
    const [secModal, { open: openSec, close: closeSec }] = useDisclosure(false);

    const [newSem, setNewSem] = useState({ name: '', start_date: '', end_date: '', is_active: 'false' });
    const [newSec, setNewSec] = useState({ course_id: '', section_number: '1', expected_enrollment: 30 });
    const [saving, setSaving] = useState(false);

    useEffect(() => { fetchAll(); }, []);
    useEffect(() => { if (selectedSemester) fetchSections(selectedSemester); }, [selectedSemester]);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            const [semRes, courseRes] = await Promise.all([
                apiClient.get('/scheduling/semesters'),
                apiClient.get('/catalog/courses')
            ]);
            setSemesters(semRes.data);
            setCourses(courseRes.data);
            if (semRes.data.length > 0) setSelectedSemester(semRes.data[0].id);
        } catch { } finally { setIsLoading(false); }
    };

    const fetchSections = async (semId: string) => {
        try {
            const res = await apiClient.get(`/scheduling/sections?semester_id=${semId}`);
            setSections(res.data);
        } catch { setSections([]); }
    };

    const handleAddSemester = async () => {
        setSaving(true);
        try {
            await apiClient.post('/scheduling/semesters', { ...newSem, is_active: newSem.is_active === 'true' });
            setNewSem({ name: '', start_date: '', end_date: '', is_active: 'false' });
            closeSem(); fetchAll();
        } catch (e: any) { alert(e?.response?.data?.detail || 'Failed'); }
        finally { setSaving(false); }
    };

    const handleAddSection = async () => {
        if (!selectedSemester) return;
        setSaving(true);
        try {
            await apiClient.post('/scheduling/sections', { ...newSec, semester_id: selectedSemester });
            setNewSec({ course_id: '', section_number: '1', expected_enrollment: 30 });
            closeSec(); fetchSections(selectedSemester);
        } catch (e: any) { alert(e?.response?.data?.detail || 'Failed'); }
        finally { setSaving(false); }
    };

    const handleDeleteSection = async (id: string) => {
        if (!confirm('Delete this section?')) return;
        try { await apiClient.delete(`/scheduling/sections/${id}`); if (selectedSemester) fetchSections(selectedSemester); }
        catch { alert('Failed'); }
    };

    const handleGenerate = async () => {
        if (!selectedSemester) return;
        setGenerating(true); setGenResult(null);
        try {
            const res = await apiClient.post(`/scheduling/generate/${selectedSemester}`);
            setGenResult({ success: true, ...res.data });
        } catch (e: any) {
            setGenResult({ success: false, message: e?.response?.data?.detail || 'Generation failed' });
        } finally { setGenerating(false); }
    };

    const activeSemester = semesters.find(s => s.id === selectedSemester);

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)' }}>
                        <Group justify="space-between" align="center">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconCalendarTime size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Timetable</Text>
                                    <Title order={2}>Scheduling</Title>
                                </Box>
                            </Group>
                            <Button leftSection={<IconPlus size={16}/>} onClick={openSem} variant="light" color="brand" radius="lg">New Semester</Button>
                        </Group>
                    </Paper>

                    {isLoading ? (
                        <Stack gap="sm">{[1,2].map(i => <Skeleton key={i} height={100} radius="xl"/>)}</Stack>
                    ) : (
                        <>
                        {/* Semester Selector */}
                        {semesters.length > 0 && (
                            <Paper p="lg" radius="xl" withBorder shadow="sm">
                                <Text size="sm" fw={700} c="dimmed" mb="sm" tt="uppercase">Select Semester</Text>
                                <Group gap="sm" wrap="wrap">
                                    {semesters.map(sem => (
                                        <Button
                                            key={sem.id}
                                            variant={selectedSemester === sem.id ? 'gradient' : 'light'}
                                            gradient={{ from: 'brand.6', to: 'sky.5' }}
                                            color="brand"
                                            radius="lg"
                                            onClick={() => setSelectedSemester(sem.id)}
                                            rightSection={sem.is_active ? <Badge size="xs" color="green" variant="filled">Active</Badge> : undefined}
                                        >
                                            {sem.name}
                                        </Button>
                                    ))}
                                </Group>
                            </Paper>
                        )}

                        {selectedSemester && (
                            <Tabs defaultValue="sections" radius="lg">
                                <Tabs.List mb="md">
                                    <Tabs.Tab value="sections">Sections ({sections.length})</Tabs.Tab>
                                    <Tabs.Tab value="generate">Generate Schedule</Tabs.Tab>
                                </Tabs.List>

                                <Tabs.Panel value="sections">
                                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                                        <Group justify="space-between" mb="md">
                                            <Text fw={600}>Sections for {activeSemester?.name}</Text>
                                            <Button leftSection={<IconPlus size={16}/>} onClick={openSec} size="sm" radius="lg" variant="light" color="brand" disabled={courses.length === 0}>
                                                Add Section
                                            </Button>
                                        </Group>
                                        {sections.length === 0 ? (
                                            <Stack align="center" py="lg" gap="xs">
                                                <Text c="dimmed" size="sm">No sections yet for this semester.</Text>
                                                <Text c="dimmed" size="xs">Add course sections, then generate a schedule.</Text>
                                            </Stack>
                                        ) : (
                                            <Table striped highlightOnHover verticalSpacing="sm">
                                                <Table.Thead>
                                                    <Table.Tr>
                                                        <Table.Th>Course</Table.Th><Table.Th>Section #</Table.Th>
                                                        <Table.Th>Enrollment</Table.Th><Table.Th style={{width:60}}></Table.Th>
                                                    </Table.Tr>
                                                </Table.Thead>
                                                <Table.Tbody>
                                                    {sections.map(sec => {
                                                        const course = courses.find(c => c.id === sec.course_id);
                                                        return (
                                                            <Table.Tr key={sec.id}>
                                                                <Table.Td>
                                                                    <Badge variant="light" color="brand">{course?.code || '—'}</Badge>
                                                                    <Text size="xs" c="dimmed" ml={4} span>{course?.title}</Text>
                                                                </Table.Td>
                                                                <Table.Td><Text fw={500}>Section {sec.section_number}</Text></Table.Td>
                                                                <Table.Td><Text size="sm">{sec.expected_enrollment}</Text></Table.Td>
                                                                <Table.Td>
                                                                    <ActionIcon color="red" variant="subtle" size="sm" onClick={() => handleDeleteSection(sec.id)}><IconTrash size={15}/></ActionIcon>
                                                                </Table.Td>
                                                            </Table.Tr>
                                                        );
                                                    })}
                                                </Table.Tbody>
                                            </Table>
                                        )}
                                    </Paper>
                                </Tabs.Panel>

                                <Tabs.Panel value="generate">
                                    <Paper p="lg" radius="xl" withBorder shadow="sm">
                                        <Stack gap="md">
                                            <Text fw={600}>Auto-generate schedule for <strong>{activeSemester?.name}</strong></Text>
                                            <Text size="sm" c="dimmed">The scheduler will place all {sections.length} section(s) into a conflict-free weekly timetable based on available faculty and rooms.</Text>
                                            {genResult && (
                                                <Alert color={genResult.success ? 'teal' : 'red'} icon={genResult.success ? <IconCheck size={16}/> : <IconAlertCircle size={16}/>} radius="lg">
                                                    {genResult.success
                                                        ? `Schedule generated! Placed: ${genResult.placed ?? '—'}, Failed: ${genResult.failed ?? '—'}`
                                                        : genResult.message}
                                                </Alert>
                                            )}
                                            <Button
                                                leftSection={<IconPlayerPlay size={16}/>}
                                                onClick={handleGenerate}
                                                loading={generating}
                                                size="md"
                                                variant="gradient"
                                                gradient={{ from: 'brand.6', to: 'sky.5' }}
                                                radius="lg"
                                                disabled={sections.length === 0}
                                            >
                                                Generate Schedule
                                            </Button>
                                        </Stack>
                                    </Paper>
                                </Tabs.Panel>
                            </Tabs>
                        )}

                        {semesters.length === 0 && (
                            <Paper p="xl" radius="xl" withBorder>
                                <Stack align="center" gap="sm">
                                    <Text c="dimmed" fw={500}>No semesters found</Text>
                                    <Button leftSection={<IconPlus size={16}/>} onClick={openSem} radius="lg" variant="light">Create first semester</Button>
                                </Stack>
                            </Paper>
                        )}
                        </>
                    )}
                </Stack>
            </Container>

            {/* Add Semester Modal */}
            <Modal opened={semModal} onClose={closeSem} title="New Semester" radius="xl" centered>
                <Stack gap="md">
                    <TextInput label="Name" placeholder="e.g. Fall 2026" value={newSem.name} onChange={e => setNewSem({...newSem, name: e.target.value})} required radius="lg"/>
                    <TextInput label="Start Date" placeholder="YYYY-MM-DD" value={newSem.start_date} onChange={e => setNewSem({...newSem, start_date: e.target.value})} required radius="lg"/>
                    <TextInput label="End Date" placeholder="YYYY-MM-DD" value={newSem.end_date} onChange={e => setNewSem({...newSem, end_date: e.target.value})} required radius="lg"/>
                    <Select label="Status" data={[{value:'false',label:'Inactive'},{value:'true',label:'Active'}]} value={newSem.is_active} onChange={v => setNewSem({...newSem, is_active: v || 'false'})} radius="lg"/>
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={closeSem} radius="lg">Cancel</Button>
                        <Button onClick={handleAddSemester} loading={saving} radius="lg" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} disabled={!newSem.name || !newSem.start_date || !newSem.end_date}>Save</Button>
                    </Group>
                </Stack>
            </Modal>

            {/* Add Section Modal */}
            <Modal opened={secModal} onClose={closeSec} title="Add Section" radius="xl" centered>
                <Stack gap="md">
                    <Select
                        label="Course"
                        data={courses.map(c => ({ value: c.id, label: `${c.code} – ${c.title}` }))}
                        value={newSec.course_id}
                        onChange={v => setNewSec({...newSec, course_id: v || ''})}
                        searchable required radius="lg"
                        placeholder="Search courses..."
                    />
                    <TextInput label="Section Number" placeholder="1" value={newSec.section_number} onChange={e => setNewSec({...newSec, section_number: e.target.value})} required radius="lg"/>
                    <NumberInput label="Expected Enrollment" value={newSec.expected_enrollment} onChange={v => setNewSec({...newSec, expected_enrollment: Number(v)})} min={1} radius="lg"/>
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={closeSec} radius="lg">Cancel</Button>
                        <Button onClick={handleAddSection} loading={saving} radius="lg" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} disabled={!newSec.course_id}>Save</Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
