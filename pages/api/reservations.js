// pages/api/reservations.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req, res) {
  // Create a temporary reservation
  if (req.method === 'POST') {
    try {
      const { seatIds, email } = req.body;

      if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
        return res.status(400).json({ error: 'No seats specified' });
      }

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Check if all seats are available
      const seats = await prisma.seat.findMany({
        where: {
          id: { in: seatIds },
        },
      });

      if (seats.length !== seatIds.length) {
        return res.status(400).json({ error: 'One or more seats not found' });
      }

      const unavailableSeats = seats.filter(seat => !seat.available);
      if (unavailableSeats.length > 0) {
        return res.status(400).json({ 
          error: 'One or more seats are no longer available',
          unavailableSeats: unavailableSeats.map(s => s.id),
        });
      }

      // Create a reservation with 15-minute expiry
      const expiryTime = new Date();
      expiryTime.setMinutes(expiryTime.getMinutes() + 15);

      const reservation = await prisma.reservation.create({
        data: {
          email,
          expiresAt: expiryTime,
          status: 'PENDING',
          totalAmount: seats.reduce((sum, seat) => sum + seat.price, 0),
          reservedSeats: {
            create: seatIds.map(seatId => ({
              seat: { connect: { id: seatId } },
            })),
          },
        },
        include: {
          reservedSeats: {
            include: {
              seat: true,
            },
          },
        },
      });

      // Mark seats as unavailable temporarily
      await prisma.seat.updateMany({
        where: {
          id: { in: seatIds },
        },
        data: {
          available: false,
        },
      });

      // Automatically release seats after 15 minutes if unpaid
      setTimeout(async () => {
        try {
          const reservationCheck = await prisma.reservation.findUnique({
            where: { id: reservation.id },
          });

          if (reservationCheck && reservationCheck.status === 'PENDING') {
            await prisma.seat.updateMany({
              where: {
                id: { in: seatIds },
              },
              data: {
                available: true,
              },
            });

            await prisma.reservation.update({
              where: { id: reservation.id },
              data: { status: 'EXPIRED' },
            });
          }
        } catch (error) {
          console.error('Failed to release seats:', error);
        }
      }, 15 * 60 * 1000); // 15 minutes

      res.status(201).json({
        reservationId: reservation.id,
        expiresAt: expiryTime,
        totalAmount: reservation.totalAmount,
      });
    } catch (error) {
      console.error('Reservation error:', error);
      res.status(500).json({ error: 'Failed to create reservation' });
    }
  } 
  // Get reservation status
  else if (req.method === 'GET') {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Reservation ID is required' });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id },
        include: {
          reservedSeats: {
            include: {
              seat: true,
            },
          },
        },
      });

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      res.status(200).json(reservation);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch reservation' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
