import { useState, useEffect } from 'react';
import {
    Container, Title, Button, Text, Paper, Group, Stack, Table,
    Modal, TextInput, Select, NumberInput, ActionIcon, Badge, Box, ThemeIcon, Skeleton, Tabs
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDoor, IconPlus, IconTrash, IconBuilding, IconBuildingWarehouse } from '@tabler/icons-react';
import { apiClient } from '../api/client';
import { PageTransition } from '../components/Layout/PageTransition';
import { confirm, errMsg, toast } from '../lib/feedback';
import { ImportCsvButton } from '../lib/ImportCsvButton';
import { DeleteAllButton } from '../lib/DeleteAllButton';
import { EditRowButton } from '../lib/EditRowButton';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { usePagedFilter } from '../lib/usePagedFilter';
import { PagedFooter } from '../lib/PagedFooter';

interface Room { id: string; room_number: string; capacity: number; type: string; building_id: string; building?: { code: string; name: string }; }
interface Building { id: string; code: string; name: string; department_id?: string | null; }
interface Dept { id: string; code: string; name: string; }

const ROOM_TYPE_COLORS: Record<string, string> = { LECTURE_HALL: 'blue', LAB: 'green', SEMINAR: 'violet' };

export function Rooms() {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [buildings, setBuildings] = useState<Building[]>([]);
    const [departments, setDepartments] = useState<Dept[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [roomModal, { open: openRoom, close: closeRoom }] = useDisclosure(false);
    const [bldModal, { open: openBld, close: closeBld }] = useDisclosure(false);
    const [newRoom, setNewRoom] = useState({ room_number: '', capacity: 30, type: 'LECTURE_HALL', building_id: '' });
    const [newBuilding, setNewBuilding] = useState({ name: '', code: '', department_id: '' });
    const [saving, setSaving] = useState(false);
    const [roomSearch, setRoomSearch] = useState('');
    const [debouncedRoomSearch] = useDebouncedValue(roomSearch, 200);

    const filteredRooms = rooms.filter(r => {
        if (!debouncedRoomSearch) return true;
        const q = debouncedRoomSearch.toLowerCase();
        return (
            r.room_number.toLowerCase().includes(q) ||
            r.type.toLowerCase().includes(q) ||
            (r.building?.code || '').toLowerCase().includes(q) ||
            (r.building?.name || '').toLowerCase().includes(q)
        );
    });
    const paged = usePagedFilter<any>(filteredRooms, { defaultPageSize: 25 });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [rRes, bRes, dRes] = await Promise.all([
                apiClient.get('/catalog/rooms'),
                apiClient.get('/catalog/buildings'),
                apiClient.get('/catalog/departments'),
            ]);
            setRooms(rRes.data); setBuildings(bRes.data); setDepartments(dRes.data);
            if (bRes.data.length > 0) setNewRoom(p => ({ ...p, building_id: bRes.data[0].id }));
        } catch { } finally { setIsLoading(false); }
    };

    const updateBuildingOwner = async (buildingId: string, departmentId: string | null) => {
        try {
            await apiClient.patch(`/catalog/buildings/${buildingId}`, { department_id: departmentId });
            toast.success(departmentId ? 'Building owner updated.' : 'Building unassigned (now shared).');
            fetchData();
        } catch (e) { toast.error(errMsg(e, 'Could not update building.')); }
    };

    const deptCode = (id: string | null | undefined) =>
        id ? (departments.find(d => d.id === id)?.code ?? '—') : null;

    const handleAddRoom = async () => {
        setSaving(true);
        try {
            await apiClient.post('/catalog/rooms', newRoom);
            setNewRoom({ ...newRoom, room_number: '' }); closeRoom(); fetchData();
        } catch (e) { toast.error(errMsg(e, 'Could not create room.')); }
        finally { setSaving(false); }
    };

    const handleAddBuilding = async () => {
        setSaving(true);
        try {
            await apiClient.post('/catalog/buildings', {
                name: newBuilding.name,
                code: newBuilding.code,
                department_id: newBuilding.department_id || null,
            });
            setNewBuilding({ name: '', code: '', department_id: '' }); closeBld(); fetchData();
        } catch (e) { toast.error(errMsg(e, 'Could not create building.')); }
        finally { setSaving(false); }
    };

    const handleDeleteRoom = async (id: string, label: string) => {
        const ok = await confirm({
            title: `Delete room ${label}?`,
            danger: true,
            confirmLabel: 'Delete room',
        });
        if (!ok) return;
        try {
            await apiClient.delete(`/catalog/rooms/${id}`);
            toast.success(`Room ${label} deleted.`);
            fetchData();
        } catch (e) {
            toast.error(errMsg(e, 'Could not delete room.'));
        }
    };

    return (
        <PageTransition>
            <Container size="xl" py="xl">
                <Stack gap="xl">
                    <Paper p="xl" radius="xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(239,246,255,0.98) 100%)', borderColor: 'rgba(148,163,184,0.18)' }}>
                        <Group justify="space-between" align="center">
                            <Group gap="md">
                                <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }}>
                                    <IconBuildingWarehouse size={22} />
                                </ThemeIcon>
                                <Box>
                                    <Text size="xs" fw={700} tt="uppercase" c="dimmed">Infrastructure</Text>
                                    <Title order={2}>Rooms & Buildings</Title>
                                </Box>
                            </Group>
                            <Group>
                                <ImportCsvButton entity="rooms" onImported={fetchData} />
                                <DeleteAllButton scope="rooms" label="Delete all rooms" cascade onDone={fetchData} />
                                <Button leftSection={<IconBuilding size={16}/>} onClick={openBld} variant="light" color="gray" radius="lg">Add Building</Button>
                                <Button leftSection={<IconPlus size={16}/>} onClick={openRoom} variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} radius="lg" disabled={buildings.length === 0}>Add Room</Button>
                            </Group>
                        </Group>
                        {buildings.length === 0 && (
                            <Text size="sm" c="orange" mt="sm">Add a building first before adding rooms.</Text>
                        )}
                    </Paper>

                    <Tabs defaultValue="rooms" radius="lg">
                        <Tabs.List mb="md">
                            <Tabs.Tab value="rooms" leftSection={<IconDoor size={16}/>}>Rooms ({rooms.length})</Tabs.Tab>
                            <Tabs.Tab value="buildings" leftSection={<IconBuilding size={16}/>}>Buildings ({buildings.length})</Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value="rooms">
                            <Paper p="lg" radius="xl" withBorder shadow="sm">
                                <Group mb="md">
                                    <TextInput
                                        placeholder="Search room number, type or building..."
                                        value={roomSearch}
                                        onChange={(e) => setRoomSearch(e.currentTarget.value)}
                                        leftSection={<IconSearch size={14}/>}
                                        radius="lg"
                                        style={{ flex: 1, maxWidth: 360 }}
                                    />
                                </Group>
                                {isLoading ? (
                                    <Stack gap="sm">{[1,2,3,4].map(i => <Skeleton key={i} height={44} radius="md"/>)}</Stack>
                                ) : paged.totalFiltered === 0 ? (
                                    <Stack align="center" py="xl" gap="sm">
                                        <ThemeIcon size={56} radius="xl" variant="light" color="gray"><IconDoor size={28}/></ThemeIcon>
                                        <Text c="dimmed" fw={500}>{debouncedRoomSearch ? 'No rooms match your search.' : 'No rooms yet'}</Text>
                                    </Stack>
                                ) : (
                                    <Table striped highlightOnHover verticalSpacing="sm">
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>Room #</Table.Th><Table.Th>Building</Table.Th>
                                                <Table.Th>Type</Table.Th><Table.Th>Capacity</Table.Th>
                                                <Table.Th style={{width:60}}></Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {paged.visible.map((room: Room) => (
                                                <Table.Tr key={room.id}>
                                                    <Table.Td><Text fw={600}>{room.room_number}</Text></Table.Td>
                                                    <Table.Td><Badge variant="outline" color="gray" size="sm">{room.building?.code || '—'}</Badge></Table.Td>
                                                    <Table.Td><Badge variant="light" color={ROOM_TYPE_COLORS[room.type] || 'gray'} size="sm">{room.type.replace('_', ' ')}</Badge></Table.Td>
                                                    <Table.Td><Text size="sm">{room.capacity}</Text></Table.Td>
                                                    <Table.Td>
                                                        <Group gap={4}>
                                                            <EditRowButton
                                                                title={`Edit room ${room.room_number}`}
                                                                endpoint={`/catalog/rooms/${room.id}`}
                                                                fields={[
                                                                    { name: 'room_number', label: 'Room number', value: room.room_number },
                                                                    { kind: 'select', name: 'building_id', label: 'Building', value: room.building_id,
                                                                        options: buildings.map(b => ({ value: b.id, label: `${b.code} — ${b.name}` })) },
                                                                    { kind: 'number', name: 'capacity', label: 'Capacity', value: room.capacity, min: 1 },
                                                                    { kind: 'select', name: 'type', label: 'Type', value: room.type,
                                                                        options: [
                                                                            { value: 'LECTURE_HALL', label: 'Lecture hall' },
                                                                            { value: 'LAB',          label: 'Lab' },
                                                                            { value: 'SEMINAR',      label: 'Seminar' },
                                                                        ] },
                                                                ]}
                                                                onSaved={fetchData}
                                                            />
                                                            <ActionIcon color="red" variant="subtle" size="sm" onClick={() => handleDeleteRoom(room.id, room.room_number)}><IconTrash size={15}/></ActionIcon>
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
                        </Tabs.Panel>

                        <Tabs.Panel value="buildings">
                            <Paper p="lg" radius="xl" withBorder shadow="sm">
                                {buildings.length === 0 ? (
                                    <Stack align="center" py="xl" gap="sm">
                                        <ThemeIcon size={56} radius="xl" variant="light" color="gray"><IconBuilding size={28}/></ThemeIcon>
                                        <Text c="dimmed" fw={500}>No buildings yet</Text>
                                        <Button size="xs" variant="light" onClick={openBld} leftSection={<IconPlus size={14}/>}>Add first building</Button>
                                    </Stack>
                                ) : (
                                    <Table striped highlightOnHover verticalSpacing="sm">
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>Code</Table.Th>
                                                <Table.Th>Name</Table.Th>
                                                <Table.Th>Owning department</Table.Th>
                                                <Table.Th># Rooms</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {buildings.map(b => {
                                                const roomsInBld = rooms.filter(r => r.building_id === b.id).length;
                                                const ownerCode = deptCode(b.department_id);
                                                return (
                                                    <Table.Tr key={b.id}>
                                                        <Table.Td><Badge variant="light" color="brand" fw={700}>{b.code}</Badge></Table.Td>
                                                        <Table.Td><Text fw={500}>{b.name}</Text></Table.Td>
                                                        <Table.Td>
                                                            <Group gap={6} wrap="nowrap">
                                                                {b.department_id ? (
                                                                    <Badge variant="light" color="indigo" radius="sm">{ownerCode}</Badge>
                                                                ) : (
                                                                    <Badge variant="outline" color="gray" radius="sm">Shared</Badge>
                                                                )}
                                                                <Select
                                                                    size="xs"
                                                                    radius="lg"
                                                                    placeholder="Assign owner…"
                                                                    value={b.department_id || null}
                                                                    onChange={(v) => updateBuildingOwner(b.id, v)}
                                                                    data={departments.map(d => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
                                                                    searchable clearable
                                                                    comboboxProps={{ withinPortal: true }}
                                                                    style={{ minWidth: 220 }}
                                                                />
                                                            </Group>
                                                        </Table.Td>
                                                        <Table.Td><Text size="sm">{roomsInBld}</Text></Table.Td>
                                                    </Table.Tr>
                                                );
                                            })}
                                        </Table.Tbody>
                                    </Table>
                                )}
                            </Paper>
                        </Tabs.Panel>
                    </Tabs>
                </Stack>
            </Container>

            <Modal opened={roomModal} onClose={closeRoom} title="Add Classroom" radius="xl" centered>
                <Stack gap="md">
                    <TextInput label="Room Number" placeholder="e.g. A101" value={newRoom.room_number} onChange={e => setNewRoom({...newRoom, room_number: e.target.value})} required radius="lg"/>
                    <Select label="Building" data={buildings.map(b => ({ value: b.id, label: `${b.code} – ${b.name}` }))} value={newRoom.building_id} onChange={v => setNewRoom({...newRoom, building_id: v || ''})} required radius="lg"/>
                    <Select label="Type" data={[{value:'LECTURE_HALL',label:'Lecture Hall'},{value:'LAB',label:'Lab'},{value:'SEMINAR',label:'Seminar'}]} value={newRoom.type} onChange={v => setNewRoom({...newRoom, type: v || 'LECTURE_HALL'})} radius="lg"/>
                    <NumberInput label="Capacity" value={newRoom.capacity} onChange={v => setNewRoom({...newRoom, capacity: Number(v)})} min={1} max={500} radius="lg"/>
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={closeRoom} radius="lg">Cancel</Button>
                        <Button onClick={handleAddRoom} loading={saving} radius="lg" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} disabled={!newRoom.room_number || !newRoom.building_id}>Save Room</Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal opened={bldModal} onClose={closeBld} title="Add Building" radius="xl" centered>
                <Stack gap="md">
                    <TextInput label="Building Name" placeholder="e.g. Science Center" value={newBuilding.name} onChange={e => setNewBuilding({...newBuilding, name: e.target.value})} required radius="lg"/>
                    <TextInput label="Code" placeholder="e.g. SC" value={newBuilding.code} onChange={e => setNewBuilding({...newBuilding, code: e.target.value})} required radius="lg"/>
                    <Select
                        label="Owning department (optional)"
                        description="Leave empty to make this a shared building."
                        placeholder="— Shared / common-use —"
                        radius="lg"
                        clearable searchable
                        data={departments.map(d => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
                        value={newBuilding.department_id || null}
                        onChange={(v) => setNewBuilding({ ...newBuilding, department_id: v || '' })}
                    />
                    <Group justify="flex-end" mt="sm">
                        <Button variant="subtle" color="gray" onClick={closeBld} radius="lg">Cancel</Button>
                        <Button onClick={handleAddBuilding} loading={saving} radius="lg" variant="gradient" gradient={{ from: 'brand.6', to: 'sky.5' }} disabled={!newBuilding.name || !newBuilding.code}>Save Building</Button>
                    </Group>
                </Stack>
            </Modal>
        </PageTransition>
    );
}
