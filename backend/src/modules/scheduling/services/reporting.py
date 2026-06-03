import io
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from typing import List
from backend.src.modules.scheduling.models import Session

class ReportGenerator:
    @staticmethod
    def generate_excel(sessions: List[Session]) -> io.BytesIO:
        wb = Workbook()
        ws = wb.active
        ws.title = "Schedule"
        
        # Header
        headers = ["Day", "Start Time", "Duration (min)", "Type", "Room", "Faculty", "Course/Section"]
        ws.append(headers)
        
        # Data
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        
        for s in sessions:
            room = s.room.room_number if s.room else "Unassigned"
            faculty = s.faculty.last_name if s.faculty else "Unassigned"
            course = s.section.course.code if s.section and s.section.course else "Unknown"
            
            ws.append([
                days[s.day_of_week] if 0 <= s.day_of_week < 5 else "Unknown",
                str(s.start_slot),
                s.duration_minutes,
                s.session_type,
                room,
                faculty,
                course
            ])
            
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

    @staticmethod
    def generate_pdf(sessions: List[Session]) -> io.BytesIO:
        output = io.BytesIO()
        doc = SimpleDocTemplate(output, pagesize=landscape(letter))
        elements = []
        styles = getSampleStyleSheet()
        
        elements.append(Paragraph("Schedule Report", styles['Title']))
        
        data = [["Day", "Time", "Type", "Course", "Room", "Faculty"]]
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        
        # Sort sessions by day then time
        sorted_sessions = sorted(sessions, key=lambda x: (x.day_of_week, x.start_slot))
        
        for s in sorted_sessions:
            room = s.room.room_number if s.room else "-"
            faculty = s.faculty.last_name if s.faculty else "-"
            course = s.section.course.code if s.section and s.section.course else "-"
            day = days[s.day_of_week] if 0 <= s.day_of_week < 5 else str(s.day_of_week)
            
            data.append([
                day,
                str(s.start_slot),
                s.session_type,
                course,
                room,
                faculty
            ])
            
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ]))
        
        elements.append(table)
        doc.build(elements)
        output.seek(0)
        return output
