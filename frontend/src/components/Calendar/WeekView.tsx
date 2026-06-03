import { useMemo, useState } from 'react';
import { Box, Text } from '@mantine/core';
import { SessionCard } from './SessionCard';
import {
    DndContext, useDraggable, useDroppable,
    type DragEndEvent, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { toast, confirm } from '../../lib/feedback';

interface CalendarEvent {
    id: string;
    day: number;        // 0=Mon … 4=Fri
    startSlot: string;  // "HH:MM:SS"
    duration: number;   // minutes
    courseCode: string;
    type: 'LECTURE' | 'LAB' | 'COMBINED';
    room: string;
    faculty: string;
    roomType: string;
}

interface WeekViewProps {
    events: CalendarEvent[];
    onEventDrop?: (eventId: string, newDay: number, newTime: string) => void;
    onEventClick?: (event: CalendarEvent) => void;
    /** Called when an item from the Unplaced Sessions panel is dropped on a cell. */
    onUnplacedDrop?: (sectionId: string, day: number, time: string) => void;
    /** Optional sidebar (e.g. UnplacedPanel) rendered inside the shared DndContext. */
    sidebar?: React.ReactNode;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const START_HOUR = 8;
const END_HOUR = 16.5;
const SLOT_HEIGHT = 54;
const TIME_COL_W = 72;
const DAY_COL_MIN = 160;

const TIME_SLOTS: string[] = [];
for (let h = START_HOUR; h < END_HOUR; h += 0.5) {
    const hour = Math.floor(h);
    const min = h % 1 === 0 ? 0 : 30;
    TIME_SLOTS.push(`${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00`);
}

function slotLabel(slot: string) { return slot.slice(0, 5); }

/** "HH:MM:SS" → minutes since midnight. */
function toMin(s: string): number {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
}
/** minutes since midnight → "HH:MM:SS". */
function toSlot(min: number): string {
    const h = Math.floor(min / 60); const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Would dropping `dragged` at (day, startSlot) collide with any other event?
 * We check three families of collision:
 *   - same room overlap (any other session in that room at that time)
 *   - same faculty overlap
 *   - any overlap at all in that slot column (visually, the cell is taken)
 */
function collisionsAt(
    dragged: CalendarEvent | null,
    targetDay: number,
    targetStart: string,
    all: CalendarEvent[],
): { type: 'faculty' | 'room' | 'cell'; with: CalendarEvent }[] {
    if (!dragged) return [];
    const startMin = toMin(targetStart);
    const endMin = startMin + dragged.duration;
    const hits: { type: 'faculty' | 'room' | 'cell'; with: CalendarEvent }[] = [];
    for (const ev of all) {
        if (ev.id === dragged.id) continue;
        if (ev.day !== targetDay) continue;
        const eStart = toMin(ev.startSlot);
        const eEnd = eStart + ev.duration;
        const overlap = startMin < eEnd && eStart < endMin;
        if (!overlap) continue;
        if (ev.faculty && ev.faculty === dragged.faculty) hits.push({ type: 'faculty', with: ev });
        else if (ev.room && ev.room === dragged.room) hits.push({ type: 'room', with: ev });
        else hits.push({ type: 'cell', with: ev });
    }
    return hits;
}

function DraggableSession({ event, spanSlots, children }: {
    event: CalendarEvent;
    spanSlots: number;
    children: React.ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: event.id,
        data: event,
    });

    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            style={{
                position: 'absolute', top: 0, left: 2, right: 2,
                height: spanSlots * SLOT_HEIGHT - 3,
                zIndex: isDragging ? 999 : 20,
                opacity: isDragging ? 0.7 : 1,
                transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
                cursor: 'grab',
            }}
        >
            {children}
        </div>
    );
}

function DroppableCell({ day, slot, conflict, children }: {
    day: number;
    slot: string;
    /** undefined = neutral cell, 'ok' = green, 'bad' = red */
    conflict: undefined | 'ok' | 'bad';
    children?: React.ReactNode;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `cell-${day}-${slot}`,
        data: { day, time: slot },
    });

    const bg =
        conflict === 'bad' ? 'rgba(239,68,68,0.18)' :
            conflict === 'ok' ? 'rgba(16,185,129,0.16)' :
                isOver ? '#e7f5ff' : undefined;

    return (
        <div
            ref={setNodeRef}
            style={{
                position: 'relative',
                height: SLOT_HEIGHT,
                borderTop: '1px solid #e9ecef',
                borderLeft: '1px solid #e9ecef',
                backgroundColor: bg,
                transition: 'background-color 0.1s',
                overflow: 'visible',
            }}
        >
            {children}
        </div>
    );
}

export function WeekView({ events, onEventDrop, onEventClick, onUnplacedDrop, sidebar }: WeekViewProps) {
    const [dragged, setDragged] = useState<CalendarEvent | null>(null);
    const [hover, setHover] = useState<{ day: number; slot: string } | null>(null);

    /** For each slot the dragged item would *touch*, decide ok/bad. */
    const conflictMap = useMemo(() => {
        const m = new Map<string, 'ok' | 'bad'>();
        if (!dragged || !hover) return m;
        const startMin = toMin(hover.slot);
        const spanSlots = Math.ceil(dragged.duration / 30);
        for (let i = 0; i < spanSlots; i++) {
            const slot = toSlot(startMin + i * 30);
            const hits = collisionsAt(dragged, hover.day, slot, events);
            m.set(`${hover.day}-${slot}`, hits.length ? 'bad' : 'ok');
        }
        return m;
    }, [dragged, hover, events]);

    const handleDragStart = (e: DragStartEvent) => {
        setDragged((e.active.data.current as CalendarEvent) ?? null);
    };
    const handleDragOver = (e: DragOverEvent) => {
        if (e.over) {
            const d = e.over.data.current as { day: number; time: string };
            setHover({ day: d.day, slot: d.time });
        } else {
            setHover(null);
        }
    };
    const handleDragEnd = (e: DragEndEvent) => {
        const { active, over } = e;
        try {
            // ── Case A: a card from the Unplaced panel was dropped on a cell ──
            const data: any = active.data?.current ?? {};
            if (over && data?.kind === 'unplaced' && onUnplacedDrop) {
                const target = over.data.current as { day: number; time: string };
                onUnplacedDrop(data.section_id as string, target.day, target.time);
                return;
            }
            if (over && active.id !== over.id && onEventDrop) {
                const target = over.data.current as { day: number; time: string };
                const hits = collisionsAt(
                    (active.data.current as CalendarEvent) ?? null,
                    target.day, target.time, events,
                );
                if (hits.length) {
                    const kinds = Array.from(new Set(hits.map(h => h.type))).join(', ');
                    const codes = hits.slice(0, 3).map(h => h.with.courseCode).join(', ');
                    const dragged = active.data.current as CalendarEvent;
                    // soft toast + confirm modal — no native alert()
                    toast.warn(
                        `${hits.length} conflict(s) at the drop target — ${kinds}. Hold on…`,
                    );
                    void confirm({
                        title: 'Drop into a conflicting slot?',
                        confirmLabel: 'Move anyway',
                        cancelLabel: 'Cancel — keep original',
                        danger: true,
                        body: (
                            <span style={{ fontSize: 14 }}>
                                Moving <strong>{dragged?.courseCode}</strong> here will overlap with{' '}
                                <strong>{codes}</strong>{hits.length > 3 ? '…' : ''}<br />
                                Conflict type: <em>{kinds}</em>.
                            </span>
                        ),
                    }).then((ok) => {
                        if (ok) {
                            onEventDrop(active.id as string, target.day, target.time);
                            toast.warn('Moved — conflicts now exist. Visit Conflicts → Auto-fix to resolve.');
                        } else {
                            toast.info ? toast.info('Move cancelled.') : toast.success('Move cancelled.');
                        }
                    });
                } else {
                    onEventDrop(active.id as string, target.day, target.time);
                    toast.success(`Moved ${(active.data.current as CalendarEvent)?.courseCode} to ${['Mon','Tue','Wed','Thu','Fri'][target.day]} ${target.time.slice(0,5)}.`);
                }
            }
        } finally {
            setDragged(null);
            setHover(null);
        }
    };

    const eventMap = new Map<string, CalendarEvent>();
    events.forEach(ev => {
        const parts = ev.startSlot.split(':');
        const normalised = `${parts[0].padStart(2, '0')}:${parts[1]}:${parts[2] ?? '00'}`;
        eventMap.set(`${ev.day}-${normalised}`, ev);
    });

    const totalWidth = TIME_COL_W + DAY_COL_MIN * 5;

    return (
        <DndContext onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {sidebar && (
                    <div style={{ flex: '0 0 300px', minWidth: 280, maxWidth: 340 }}>
                        {sidebar}
                    </div>
                )}
                <Box style={{ flex: 1, minWidth: 0, overflowX: 'auto', border: '1px solid #dee2e6', borderRadius: 8 }}>
                <div style={{ minWidth: totalWidth }}>
                    {/* Header row */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: `${TIME_COL_W}px repeat(5, minmax(${DAY_COL_MIN}px, 1fr))`,
                        position: 'sticky', top: 0, zIndex: 50, backgroundColor: '#1F3864',
                    }}>
                        <div style={{ borderRight: '1px solid #2E5090' }} />
                        {DAYS.map(d => (
                            <div key={d} style={{
                                padding: '10px 8px', textAlign: 'center', fontWeight: 700,
                                fontSize: 12, letterSpacing: '0.6px', color: '#FFFFFF',
                                textTransform: 'uppercase', borderLeft: '1px solid #2E5090',
                            }}>{d}</div>
                        ))}
                    </div>

                    {/* Body: one row per 30-min slot */}
                    {TIME_SLOTS.map((slot) => (
                        <div key={slot} style={{
                            display: 'grid',
                            gridTemplateColumns: `${TIME_COL_W}px repeat(5, minmax(${DAY_COL_MIN}px, 1fr))`,
                        }}>
                            <div style={{
                                padding: '8px 6px', textAlign: 'right', fontSize: 11,
                                color: '#475569', borderTop: '1px solid #e9ecef',
                                borderRight: '1px solid #e9ecef', background: '#f8fafc',
                                fontVariantNumeric: 'tabular-nums',
                            }}>{slotLabel(slot)}</div>

                            {DAYS.map((_, day) => {
                                const ev = eventMap.get(`${day}-${slot}`);
                                const key = `${day}-${slot}`;
                                const conflictState = conflictMap.get(key);
                                const spanSlots = ev ? Math.max(1, Math.ceil(ev.duration / 30)) : 1;
                                return (
                                    <DroppableCell key={key} day={day} slot={slot} conflict={conflictState}>
                                        {ev && (
                                            <DraggableSession event={ev} spanSlots={spanSlots}>
                                                <div onClickCapture={(e) => {
                                                    // Only treat as click if drag hasn't started — dnd-kit handles drags via mousedown,
                                                    // so a plain click on the card will fall through here.
                                                    if (onEventClick) { e.stopPropagation(); onEventClick(ev); }
                                                }}>
                                                    <SessionCard
                                                        courseCode={ev.courseCode}
                                                        type={ev.type}
                                                        room={ev.room}
                                                        faculty={ev.faculty}
                                                        duration={ev.duration}
                                                    />
                                                </div>
                                            </DraggableSession>
                                        )}
                                    </DroppableCell>
                                );
                            })}
                        </div>
                    ))}

                    {/* Footer hint */}
                    {dragged && (
                        <Box p="sm" style={{ background: '#fff7ed', borderTop: '1px solid #fed7aa' }}>
                            <Text size="xs" c="dimmed">
                                Dragging <strong>{dragged.courseCode}</strong> — green cells are safe, red cells already
                                contain a conflict (faculty or room overlap).
                            </Text>
                        </Box>
                    )}
                </div>
                </Box>
            </div>
        </DndContext>
    );
}
