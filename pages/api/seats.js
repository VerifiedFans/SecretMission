// pages/api/seats.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req, res) {
  // Get all seats
  if (req.method === 'GET') {
    try {
      const seats = await prisma.seat.findMany();
      res.status(200).json(seats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch seats' });
    }
  } 
  // Create seats (admin only in real implementation)
  else if (req.method === 'POST') {
    try {
      const { section, row, number, price } = req.body;

      const seat = await prisma.seat.create({
        data: {
          section,
          row,
          number,
          price,
          available: true,
        },
      });

      res.status(201).json(seat);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create seat' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
